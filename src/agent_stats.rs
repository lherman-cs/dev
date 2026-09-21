use anyhow::{Context, Result, bail};
use chrono::{DateTime, Local, Utc};
use crossterm::event::{self, Event as TerminalEvent, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, IsTerminal, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use walkdir::WalkDir;

const BLUE: Color = Color::Rgb(14, 165, 233);
const GREEN: Color = Color::Rgb(16, 185, 129);
const MINT: Color = Color::Rgb(110, 231, 183);
const ORANGE: Color = Color::Rgb(245, 158, 11);
const PURPLE: Color = Color::Rgb(139, 92, 246);
const MUTED: Color = Color::Rgb(148, 163, 184);
const TRACK: Color = Color::Rgb(30, 41, 59);
const GRID: Color = Color::Rgb(55, 65, 81);

// Source -> normalized model -> aggregation. Rendering below consumes only Dashboard.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Usage {
    input: Option<u64>,
    output: Option<u64>,
    cache_read: Option<u64>,
    cache_write: Option<u64>,
    reasoning: Option<u64>,
    provider_total: Option<u64>,
}

impl Usage {
    fn is_present(self) -> bool {
        self.input.is_some()
            || self.output.is_some()
            || self.cache_read.is_some()
            || self.cache_write.is_some()
            || self.reasoning.is_some()
            || self.provider_total.is_some()
    }

    fn normalize(self) -> Option<NormalizedUsage> {
        let computed_prompt = self.input?.checked_add(self.cache_write?)?;
        let input = computed_prompt.checked_add(self.cache_read?)?;
        let output = self.output?;
        Some(NormalizedUsage {
            cached_prompt: self.cache_read?,
            computed_prompt,
            input,
            output,
            reasoning: self.reasoning,
            total: input.checked_add(output)?,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct NormalizedUsage {
    cached_prompt: u64,
    computed_prompt: u64,
    input: u64,
    output: u64,
    reasoning: Option<u64>,
    total: u64,
}

impl NormalizedUsage {
    fn checked_add(self, other: Self) -> Option<Self> {
        Some(Self {
            cached_prompt: self.cached_prompt.checked_add(other.cached_prompt)?,
            computed_prompt: self.computed_prompt.checked_add(other.computed_prompt)?,
            input: self.input.checked_add(other.input)?,
            output: self.output.checked_add(other.output)?,
            reasoning: match (self.reasoning, other.reasoning) {
                (Some(left), Some(right)) => Some(left.checked_add(right)?),
                _ => None,
            },
            total: self.total.checked_add(other.total)?,
        })
    }
}

#[derive(Clone, Debug)]
struct ToolCall {
    id: String,
    name: String,
    summary: String,
}

#[derive(Clone, Debug)]
enum RecordKind {
    User,
    Assistant {
        model: Option<String>,
        started_at: Option<i64>,
        usage: Usage,
        calls: Vec<ToolCall>,
    },
    ToolResult {
        call_id: String,
        name: Option<String>,
        failed: Option<bool>,
        usage: Usage,
    },
    Compaction {
        usage: Usage,
    },
    Usage(Usage),
    Other,
    Invalid,
}

#[derive(Clone, Debug)]
struct Record {
    id: String,
    parent: Option<String>,
    at: Option<i64>,
    kind: RecordKind,
}

#[derive(Clone, Debug, Default)]
struct SessionModel {
    id: String,
    cwd: PathBuf,
    started_at: Option<i64>,
    records: Vec<Record>,
    malformed: u64,
    incomplete_trailing: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LaneKind {
    Turns,
    User,
    Generation,
    Tool,
    Compaction,
    Auxiliary,
    UnmatchedResult,
}

#[derive(Clone, Debug)]
struct Activity {
    id: String,
    lane: String,
    kind: LaneKind,
    start: i64,
    end: i64,
    label: String,
    status: Option<String>,
    usage: Usage,
    turn: usize,
    detail: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DurationStat {
    ObservedWall,
    Cumulative,
}

#[derive(Clone, Debug)]
struct Lane {
    name: String,
    kind: LaneKind,
    events: Vec<usize>,
    count: u64,
    duration_ms: Option<i64>,
    duration_stat: Option<DurationStat>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Diagnostics {
    abandoned_branch: u64,
    unknown_internal: u64,
    malformed: u64,
    invalid: u64,
    incomplete_trailing: bool,
    unmatched_results: u64,
    duplicate_or_invalid_call_id: u64,
    missing_timing: u64,
    missing_usage: u64,
    provider_total_mismatch: u64,
}

impl Diagnostics {
    fn issue_count(&self) -> u64 {
        self.abandoned_branch
            .saturating_add(self.unknown_internal)
            .saturating_add(self.malformed)
            .saturating_add(self.invalid)
            .saturating_add(self.unmatched_results)
            .saturating_add(self.duplicate_or_invalid_call_id)
            .saturating_add(self.missing_timing)
            .saturating_add(self.missing_usage)
            .saturating_add(self.provider_total_mismatch)
            .saturating_add(u64::from(self.incomplete_trailing))
    }
}

#[derive(Debug, Default)]
struct Metrics {
    usage: Option<NormalizedUsage>,
    wall_ms: Option<i64>,
    turns: usize,
    avg_wall_per_turn_ms: Option<i64>,
    event_count: usize,
    user_count: usize,
    generation_count: usize,
    compaction_count: usize,
    auxiliary_count: usize,
    unmatched_result_count: usize,
    tool_call_count: usize,
    completed_tool_count: usize,
    open_tool_count: usize,
    timed_tool_count: usize,
    timed_generation_count: usize,
    model_cumulative_ms: Option<i64>,
    model_wall_ms: Option<i64>,
    model_avg_ms: Option<i64>,
    model_p95_ms: Option<i64>,
    tool_cumulative_ms: Option<i64>,
    tool_wall_ms: Option<i64>,
    tool_overlap_ms: Option<i64>,
    tool_avg_ms: Option<i64>,
    tool_p95_ms: Option<i64>,
    model_only_ms: Option<i64>,
    tool_only_ms: Option<i64>,
    model_tool_overlap_ms: Option<i64>,
    waiting_ms: Option<i64>,
    residual_ms: Option<i64>,
}

#[derive(Debug, Default)]
struct Dashboard {
    session_id: String,
    start: Option<i64>,
    end: Option<i64>,
    metrics: Metrics,
    activities: Vec<Activity>,
    lanes: Vec<Lane>,
    turn_starts: Vec<i64>,
    diagnostics: Diagnostics,
    provisional: bool,
}

struct LiveSource {
    path: PathBuf,
    file: File,
    offset: u64,
    pending: Vec<u8>,
    model: SessionModel,
}

impl LiveSource {
    fn open(path: PathBuf) -> Result<Self> {
        let file =
            File::open(&path).with_context(|| format!("open Pi session {}", path.display()))?;
        let mut source = Self {
            path,
            file,
            offset: 0,
            pending: Vec::new(),
            model: SessionModel::default(),
        };
        source.read_updates()?;
        if source.model.id.is_empty() {
            bail!("{} is not a valid Pi session", source.path.display());
        }
        Ok(source)
    }

    fn read_updates(&mut self) -> Result<bool> {
        let len = self.file.metadata()?.len();
        if len < self.offset {
            self.file = File::open(&self.path)?;
            self.offset = 0;
            self.pending.clear();
            self.model = SessionModel::default();
        }
        self.file.seek(SeekFrom::Start(self.offset))?;
        let mut bytes = Vec::new();
        self.file.read_to_end(&mut bytes)?;
        if bytes.is_empty() {
            self.model.incomplete_trailing = !self.pending.is_empty();
            return Ok(false);
        }
        self.offset = self.offset.saturating_add(bytes.len() as u64);
        self.pending.extend(bytes);
        let complete = self
            .pending
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(0);
        self.model.incomplete_trailing = complete < self.pending.len();
        if complete == 0 {
            return Ok(false);
        }
        let lines: Vec<u8> = self.pending.drain(..complete).collect();
        for raw in lines
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
        {
            match serde_json::from_slice::<Value>(raw) {
                Ok(value) => parse_value(value, &mut self.model),
                Err(_) => self.model.malformed = self.model.malformed.saturating_add(1),
            }
        }
        Ok(true)
    }
}

fn parse_value(value: Value, model: &mut SessionModel) {
    if value.get("type").and_then(Value::as_str) == Some("session") {
        model.id = text(&value, "id").unwrap_or_default().to_owned();
        model.cwd = text(&value, "cwd").map(PathBuf::from).unwrap_or_default();
        model.started_at = parse_time(value.get("timestamp"));
        return;
    }
    let kind = match value.get("type").and_then(Value::as_str) {
        Some("message") => parse_message(value.get("message")),
        Some("compaction") => RecordKind::Compaction {
            usage: parse_usage(value.get("usage")),
        },
        Some("usage") => RecordKind::Usage(parse_usage(value.get("usage"))),
        _ => RecordKind::Other,
    };
    model.records.push(Record {
        id: text(&value, "id").unwrap_or_default().to_owned(),
        parent: text(&value, "parentId").map(str::to_owned),
        at: parse_time(value.get("timestamp")),
        kind,
    });
}

fn parse_message(message: Option<&Value>) -> RecordKind {
    let Some(message) = message else {
        return RecordKind::Invalid;
    };
    match text(message, "role") {
        Some("user") => RecordKind::User,
        Some("assistant") => {
            let calls = message
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|part| text(part, "type") == Some("toolCall"))
                .map(|part| ToolCall {
                    id: text(part, "id").unwrap_or_default().to_owned(),
                    name: text(part, "name").unwrap_or("unknown").to_owned(),
                    summary: summarize(part.get("arguments")),
                })
                .collect();
            RecordKind::Assistant {
                model: text(message, "model").map(str::to_owned),
                started_at: parse_time(message.get("timestamp")),
                usage: parse_usage(message.get("usage")),
                calls,
            }
        }
        Some("toolResult") => RecordKind::ToolResult {
            call_id: text(message, "toolCallId").unwrap_or_default().to_owned(),
            name: text(message, "toolName").map(str::to_owned),
            failed: message.get("isError").and_then(Value::as_bool),
            usage: parse_usage(message.get("usage")),
        },
        Some(_) => RecordKind::Other,
        None => RecordKind::Invalid,
    }
}

fn summarize(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    let compact = match value {
        Value::Object(map) => map
            .iter()
            .take(3)
            .map(|(key, value)| format!("{key}={}", scalar(value)))
            .collect::<Vec<_>>()
            .join(" "),
        other => scalar(other),
    };
    compact.chars().take(160).collect()
}

fn scalar(value: &Value) -> String {
    match value {
        Value::String(text) => text.chars().take(80).collect(),
        Value::Number(number) => number.to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Null => "null".into(),
        Value::Array(values) => format!("[{} items]", values.len()),
        Value::Object(values) => format!("{{{} fields}}", values.len()),
    }
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}
fn parse_time(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number.as_i64(),
        Some(Value::String(text)) => DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|time| time.timestamp_millis()),
        _ => None,
    }
}
fn parse_usage(value: Option<&Value>) -> Usage {
    let Some(value) = value else {
        return Usage::default();
    };
    Usage {
        input: uint(value, "input"),
        output: uint(value, "output"),
        cache_read: uint(value, "cacheRead"),
        cache_write: uint(value, "cacheWrite"),
        reasoning: uint(value, "reasoning"),
        provider_total: uint(value, "totalTokens"),
    }
}
fn uint(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

struct BranchSelection<'a> {
    records: Vec<&'a Record>,
    excluded: u64,
    invalid: u64,
}

fn active_branch(model: &SessionModel) -> BranchSelection<'_> {
    let Some(last) = model
        .records
        .iter()
        .rev()
        .find(|record| !record.id.is_empty())
    else {
        return BranchSelection {
            records: model.records.iter().collect(),
            excluded: 0,
            invalid: 0,
        };
    };
    let mut by_id = HashMap::new();
    let mut invalid = 0_u64;
    for record in model.records.iter().filter(|record| !record.id.is_empty()) {
        if by_id.insert(record.id.as_str(), record).is_some() {
            invalid = invalid.saturating_add(1);
        }
    }
    let mut branch = Vec::new();
    let mut next = Some(last.id.as_str());
    let mut seen = HashSet::new();
    while let Some(id) = next {
        if !seen.insert(id) {
            invalid = invalid.saturating_add(1);
            break;
        }
        let Some(record) = by_id.get(id).copied() else {
            invalid = invalid.saturating_add(1);
            break;
        };
        branch.push(record);
        next = record.parent.as_deref();
    }
    branch.reverse();
    BranchSelection {
        excluded: model.records.len().saturating_sub(branch.len()) as u64,
        records: branch,
        invalid,
    }
}

#[derive(Default)]
struct UsageAccumulator {
    value: Option<NormalizedUsage>,
    operations: usize,
    valid: bool,
}

impl UsageAccumulator {
    fn add(&mut self, usage: Usage, required: bool, diagnostics: &mut Diagnostics) {
        if !usage.is_present() {
            if required {
                diagnostics.missing_usage = diagnostics.missing_usage.saturating_add(1);
                self.valid = false;
            }
            return;
        }
        self.operations = self.operations.saturating_add(1);
        let Some(normalized) = usage.normalize() else {
            diagnostics.missing_usage = diagnostics.missing_usage.saturating_add(1);
            self.valid = false;
            return;
        };
        if normalized
            .reasoning
            .is_some_and(|reasoning| reasoning > normalized.output)
        {
            diagnostics.invalid = diagnostics.invalid.saturating_add(1);
            self.valid = false;
            return;
        }
        if usage
            .provider_total
            .is_some_and(|total| total != normalized.total)
        {
            diagnostics.provider_total_mismatch =
                diagnostics.provider_total_mismatch.saturating_add(1);
        }
        self.value = match self.value {
            None => Some(normalized),
            Some(value) => match value.checked_add(normalized) {
                Some(total) => Some(total),
                None => {
                    diagnostics.invalid = diagnostics.invalid.saturating_add(1);
                    self.valid = false;
                    None
                }
            },
        };
    }

    fn finish(self) -> Option<NormalizedUsage> {
        (self.valid && self.operations > 0)
            .then_some(self.value)
            .flatten()
    }
}

#[derive(Clone)]
struct OpenCall {
    call: ToolCall,
    start: Option<i64>,
    turn: usize,
}

#[derive(Default)]
struct ToolBucket {
    count: u64,
    events: Vec<usize>,
    durations: Vec<i64>,
}

fn aggregate(model: &SessionModel) -> Dashboard {
    let selection = active_branch(model);
    let mut dashboard = Dashboard {
        session_id: model.id.clone(),
        start: model.started_at,
        diagnostics: Diagnostics {
            abandoned_branch: selection.excluded,
            malformed: model.malformed,
            invalid: selection.invalid,
            incomplete_trailing: model.incomplete_trailing,
            ..Diagnostics::default()
        },
        ..Dashboard::default()
    };
    let mut usage = UsageAccumulator {
        valid: true,
        ..UsageAccumulator::default()
    };
    let mut calls: Vec<OpenCall> = Vec::new();
    let mut tool_buckets: BTreeMap<String, ToolBucket> = BTreeMap::new();
    let mut model_candidates = Vec::new();
    let mut tool_intervals = Vec::new();
    let mut waiting_candidates = Vec::new();
    let mut waiting_start = None;
    let mut turn = 0_usize;

    for record in selection.records {
        if let Some(at) = record.at {
            dashboard.end = Some(dashboard.end.map_or(at, |old| old.max(at)));
        }
        match &record.kind {
            RecordKind::User => {
                dashboard.metrics.user_count = dashboard.metrics.user_count.saturating_add(1);
                turn = turn.saturating_add(1);
                if let Some(at) = record.at {
                    if let Some(start) = waiting_start.take()
                        && start <= at
                    {
                        waiting_candidates.push((start, at));
                    }
                    dashboard.turn_starts.push(at);
                } else {
                    dashboard.diagnostics.missing_timing =
                        dashboard.diagnostics.missing_timing.saturating_add(1);
                }
                add_point(
                    &mut dashboard,
                    &record.id,
                    "user messages",
                    LaneKind::User,
                    record.at,
                    "user",
                    None,
                    Usage::default(),
                    turn,
                    "user message",
                );
            }
            RecordKind::Assistant {
                model: provider,
                started_at,
                usage: record_usage,
                calls: tool_calls,
            } => {
                dashboard.metrics.generation_count =
                    dashboard.metrics.generation_count.saturating_add(1);
                usage.add(*record_usage, true, &mut dashboard.diagnostics);
                let interval = match (*started_at, record.at) {
                    (Some(start), Some(end)) if start <= end => {
                        model_candidates.push((start, end));
                        Some((start, end))
                    }
                    _ => {
                        dashboard.diagnostics.missing_timing =
                            dashboard.diagnostics.missing_timing.saturating_add(1);
                        None
                    }
                };
                add_interval(
                    &mut dashboard,
                    &record.id,
                    "generations",
                    LaneKind::Generation,
                    interval,
                    record.at,
                    "assistant",
                    None,
                    *record_usage,
                    turn,
                    &format!(
                        "assistant response · {}",
                        provider.as_deref().unwrap_or("unknown model")
                    ),
                );
                waiting_start = if tool_calls.is_empty() {
                    record.at
                } else {
                    None
                };
                for call in tool_calls {
                    dashboard.metrics.tool_call_count =
                        dashboard.metrics.tool_call_count.saturating_add(1);
                    let bucket = tool_buckets.entry(call.name.clone()).or_default();
                    bucket.count = bucket.count.saturating_add(1);
                    if call.id.is_empty()
                        || calls
                            .iter()
                            .any(|open| !call.id.is_empty() && open.call.id == call.id)
                    {
                        dashboard.diagnostics.duplicate_or_invalid_call_id = dashboard
                            .diagnostics
                            .duplicate_or_invalid_call_id
                            .saturating_add(1);
                    }
                    if record.at.is_none() {
                        dashboard.diagnostics.missing_timing =
                            dashboard.diagnostics.missing_timing.saturating_add(1);
                    }
                    calls.push(OpenCall {
                        call: call.clone(),
                        start: record.at,
                        turn,
                    });
                }
            }
            RecordKind::ToolResult {
                call_id,
                name,
                failed,
                usage: record_usage,
            } => {
                usage.add(*record_usage, false, &mut dashboard.diagnostics);
                let matched = (!call_id.is_empty())
                    .then(|| calls.iter().position(|open| open.call.id == *call_id))
                    .flatten();
                if let Some(position) = matched {
                    let open = calls.remove(position);
                    dashboard.metrics.completed_tool_count =
                        dashboard.metrics.completed_tool_count.saturating_add(1);
                    let interval = match (open.start, record.at) {
                        (Some(start), Some(end)) if start <= end => {
                            let duration = end - start;
                            tool_intervals.push((start, end));
                            tool_buckets
                                .entry(open.call.name.clone())
                                .or_default()
                                .durations
                                .push(duration);
                            dashboard.metrics.timed_tool_count =
                                dashboard.metrics.timed_tool_count.saturating_add(1);
                            Some((start, end))
                        }
                        _ => {
                            dashboard.diagnostics.missing_timing =
                                dashboard.diagnostics.missing_timing.saturating_add(1);
                            None
                        }
                    };
                    let index = add_interval(
                        &mut dashboard,
                        &open.call.id,
                        &open.call.name,
                        LaneKind::Tool,
                        interval,
                        record.at.or(open.start),
                        &open.call.name,
                        Some(
                            if failed.unwrap_or(false) {
                                "failed"
                            } else {
                                "ok"
                            }
                            .into(),
                        ),
                        *record_usage,
                        open.turn,
                        &open.call.summary,
                    );
                    if let Some(index) = index {
                        tool_buckets
                            .entry(open.call.name)
                            .or_default()
                            .events
                            .push(index);
                    }
                } else {
                    dashboard.metrics.unmatched_result_count =
                        dashboard.metrics.unmatched_result_count.saturating_add(1);
                    dashboard.diagnostics.unmatched_results =
                        dashboard.diagnostics.unmatched_results.saturating_add(1);
                    add_point(
                        &mut dashboard,
                        call_id,
                        "unmatched results",
                        LaneKind::UnmatchedResult,
                        record.at,
                        name.as_deref().unwrap_or("tool result"),
                        failed.map(|failed| if failed { "failed" } else { "ok" }.into()),
                        *record_usage,
                        turn,
                        "unmatched tool result",
                    );
                }
            }
            RecordKind::Compaction {
                usage: record_usage,
            } => {
                dashboard.metrics.compaction_count =
                    dashboard.metrics.compaction_count.saturating_add(1);
                usage.add(*record_usage, true, &mut dashboard.diagnostics);
                add_point(
                    &mut dashboard,
                    &record.id,
                    "compactions",
                    LaneKind::Compaction,
                    record.at,
                    "compaction",
                    None,
                    *record_usage,
                    turn,
                    "context compaction",
                );
            }
            RecordKind::Usage(record_usage) => {
                dashboard.metrics.auxiliary_count =
                    dashboard.metrics.auxiliary_count.saturating_add(1);
                usage.add(*record_usage, true, &mut dashboard.diagnostics);
                add_point(
                    &mut dashboard,
                    &record.id,
                    "auxiliary model",
                    LaneKind::Auxiliary,
                    record.at,
                    "auxiliary model",
                    None,
                    *record_usage,
                    turn,
                    "model-attributed auxiliary usage",
                );
            }
            RecordKind::Other => {
                dashboard.diagnostics.unknown_internal =
                    dashboard.diagnostics.unknown_internal.saturating_add(1)
            }
            RecordKind::Invalid => {
                dashboard.diagnostics.invalid = dashboard.diagnostics.invalid.saturating_add(1)
            }
        }
    }

    for open in calls {
        dashboard.metrics.open_tool_count = dashboard.metrics.open_tool_count.saturating_add(1);
        let index = add_point(
            &mut dashboard,
            &open.call.id,
            &open.call.name,
            LaneKind::Tool,
            open.start,
            &open.call.name,
            Some("open".into()),
            Usage::default(),
            open.turn,
            &open.call.summary,
        );
        if let Some(index) = index {
            tool_buckets
                .entry(open.call.name)
                .or_default()
                .events
                .push(index);
        }
    }

    dashboard.start = dashboard
        .start
        .or_else(|| dashboard.turn_starts.first().copied());
    let window = dashboard
        .start
        .zip(dashboard.end)
        .filter(|(start, end)| start <= end);
    if let Some((start, end)) = window {
        dashboard.metrics.wall_ms = Some(end - start);
        if let Some(first) = dashboard.turn_starts.first_mut() {
            *first = start;
        }
    } else if dashboard.start.is_some() || dashboard.end.is_some() {
        dashboard.diagnostics.invalid = dashboard.diagnostics.invalid.saturating_add(1);
    }
    dashboard.metrics.turns = turn;
    if turn > 0 {
        dashboard.metrics.avg_wall_per_turn_ms =
            dashboard.metrics.wall_ms.map(|wall| wall / turn as i64);
    }

    let model_intervals = validate_intervals(model_candidates, window, &mut dashboard.diagnostics);
    dashboard.metrics.timed_generation_count = model_intervals.len();
    if dashboard.metrics.generation_count > 0
        && dashboard.metrics.timed_generation_count == dashboard.metrics.generation_count
    {
        let durations = model_intervals
            .iter()
            .map(|(start, end)| end - start)
            .collect::<Vec<_>>();
        dashboard.metrics.model_cumulative_ms = Some(sum_durations(&durations));
        dashboard.metrics.model_wall_ms = Some(union_duration(model_intervals.clone()));
        dashboard.metrics.model_avg_ms = average_duration(&durations);
        dashboard.metrics.model_p95_ms = p95_duration(&durations);
    }
    let completed_tool_intervals =
        validate_intervals(tool_intervals, window, &mut dashboard.diagnostics);
    dashboard.metrics.timed_tool_count = completed_tool_intervals.len();
    if dashboard.metrics.completed_tool_count > 0
        && completed_tool_intervals.len() == dashboard.metrics.completed_tool_count
    {
        let durations = completed_tool_intervals
            .iter()
            .map(|(start, end)| end - start)
            .collect::<Vec<_>>();
        let cumulative = sum_durations(&durations);
        let wall = union_duration(completed_tool_intervals.clone());
        dashboard.metrics.tool_cumulative_ms = Some(cumulative);
        dashboard.metrics.tool_wall_ms = Some(wall);
        dashboard.metrics.tool_overlap_ms = Some(cumulative.saturating_sub(wall));
        dashboard.metrics.tool_avg_ms = average_duration(&durations);
        dashboard.metrics.tool_p95_ms = p95_duration(&durations);
    } else {
        for bucket in tool_buckets.values_mut() {
            bucket.durations.clear();
        }
    }

    if let Some((start, end)) = window {
        let mut decomposition_tools = completed_tool_intervals;
        for bucket in tool_buckets.values() {
            for index in &bucket.events {
                let event = &dashboard.activities[*index];
                if event.status.as_deref() == Some("open") && event.start <= end {
                    decomposition_tools.push((event.start.max(start), end));
                }
            }
        }
        let waiting = validate_intervals(waiting_candidates, window, &mut dashboard.diagnostics);
        if overlap_duration(&waiting, &model_intervals) > 0
            || overlap_duration(&waiting, &decomposition_tools) > 0
        {
            dashboard.diagnostics.invalid = dashboard.diagnostics.invalid.saturating_add(1);
        }
        let parts = decompose_wall(
            (start, end),
            &model_intervals,
            &decomposition_tools,
            &waiting,
        );
        dashboard.metrics.model_only_ms = Some(parts.model_only);
        dashboard.metrics.tool_only_ms = Some(parts.tool_only);
        dashboard.metrics.model_tool_overlap_ms = Some(parts.model_tool_overlap);
        dashboard.metrics.waiting_ms = Some(parts.waiting);
        dashboard.metrics.residual_ms = Some(parts.residual);
    }

    dashboard.metrics.usage = usage.finish();
    dashboard.metrics.event_count = dashboard
        .metrics
        .user_count
        .saturating_add(dashboard.metrics.generation_count)
        .saturating_add(dashboard.metrics.tool_call_count)
        .saturating_add(dashboard.metrics.compaction_count)
        .saturating_add(dashboard.metrics.auxiliary_count)
        .saturating_add(dashboard.metrics.unmatched_result_count);
    dashboard.provisional = dashboard.metrics.open_tool_count > 0 || model.incomplete_trailing;

    let wall_ms = dashboard.metrics.wall_ms;
    let user_count = dashboard.metrics.user_count as u64;
    let generation_count = dashboard.metrics.generation_count as u64;
    let model_cumulative_ms = dashboard.metrics.model_cumulative_ms;
    let compaction_count = dashboard.metrics.compaction_count as u64;
    let auxiliary_count = dashboard.metrics.auxiliary_count as u64;
    let unmatched_result_count = dashboard.metrics.unmatched_result_count as u64;
    if turn > 0 {
        push_lane(
            &mut dashboard,
            "Turns",
            LaneKind::Turns,
            turn as u64,
            Vec::new(),
            wall_ms,
            Some(DurationStat::ObservedWall),
        );
    }
    push_kind_lane(
        &mut dashboard,
        "User messages",
        LaneKind::User,
        user_count,
        None,
        None,
    );
    push_kind_lane(
        &mut dashboard,
        "Generations",
        LaneKind::Generation,
        generation_count,
        model_cumulative_ms,
        model_cumulative_ms.map(|_| DurationStat::Cumulative),
    );
    for (name, bucket) in tool_buckets {
        let duration = (!bucket.durations.is_empty()).then(|| sum_durations(&bucket.durations));
        push_lane(
            &mut dashboard,
            &name,
            LaneKind::Tool,
            bucket.count,
            bucket.events,
            duration,
            duration.map(|_| DurationStat::Cumulative),
        );
    }
    push_kind_lane(
        &mut dashboard,
        "Compactions",
        LaneKind::Compaction,
        compaction_count,
        None,
        None,
    );
    push_kind_lane(
        &mut dashboard,
        "Auxiliary model",
        LaneKind::Auxiliary,
        auxiliary_count,
        None,
        None,
    );
    push_kind_lane(
        &mut dashboard,
        "Unmatched results",
        LaneKind::UnmatchedResult,
        unmatched_result_count,
        None,
        None,
    );
    dashboard
}

fn union_duration(mut intervals: Vec<(i64, i64)>) -> i64 {
    intervals.sort_by_key(|interval| interval.0);
    let mut total = 0_i64;
    let mut current: Option<(i64, i64)> = None;
    for (start, end) in intervals.into_iter().filter(|(start, end)| start <= end) {
        current = match current {
            None => Some((start, end)),
            Some((old_start, old_end)) if start <= old_end => Some((old_start, old_end.max(end))),
            Some((old_start, old_end)) => {
                total = total.saturating_add(old_end.saturating_sub(old_start));
                Some((start, end))
            }
        };
    }
    if let Some((start, end)) = current {
        total = total.saturating_add(end.saturating_sub(start));
    }
    total
}

fn sum_durations(durations: &[i64]) -> i64 {
    durations
        .iter()
        .fold(0_i64, |total, duration| total.saturating_add(*duration))
}

fn overlap_duration(left: &[(i64, i64)], right: &[(i64, i64)]) -> i64 {
    let intersections = left
        .iter()
        .flat_map(|(left_start, left_end)| {
            right.iter().filter_map(move |(right_start, right_end)| {
                let start = (*left_start).max(*right_start);
                let end = (*left_end).min(*right_end);
                (start < end).then_some((start, end))
            })
        })
        .collect();
    union_duration(intersections)
}

fn average_duration(durations: &[i64]) -> Option<i64> {
    (!durations.is_empty()).then(|| sum_durations(durations) / durations.len() as i64)
}

fn p95_duration(durations: &[i64]) -> Option<i64> {
    if durations.is_empty() {
        return None;
    }
    let mut sorted = durations.to_vec();
    sorted.sort_unstable();
    Some(sorted[(95 * sorted.len() - 1) / 100])
}

fn validate_intervals(
    intervals: Vec<(i64, i64)>,
    window: Option<(i64, i64)>,
    diagnostics: &mut Diagnostics,
) -> Vec<(i64, i64)> {
    let Some((window_start, window_end)) = window else {
        if !intervals.is_empty() {
            diagnostics.missing_timing = diagnostics
                .missing_timing
                .saturating_add(intervals.len() as u64);
        }
        return Vec::new();
    };
    intervals
        .into_iter()
        .filter(|(start, end)| {
            let valid = start <= end && *start >= window_start && *end <= window_end;
            if !valid {
                diagnostics.invalid = diagnostics.invalid.saturating_add(1);
            }
            valid
        })
        .collect()
}

#[derive(Default)]
struct WallParts {
    model_only: i64,
    tool_only: i64,
    model_tool_overlap: i64,
    waiting: i64,
    residual: i64,
}

fn decompose_wall(
    window: (i64, i64),
    model: &[(i64, i64)],
    tools: &[(i64, i64)],
    waiting: &[(i64, i64)],
) -> WallParts {
    let mut boundaries = vec![window.0, window.1];
    for (start, end) in model.iter().chain(tools).chain(waiting) {
        boundaries.push((*start).clamp(window.0, window.1));
        boundaries.push((*end).clamp(window.0, window.1));
    }
    boundaries.sort_unstable();
    boundaries.dedup();
    let mut parts = WallParts::default();
    for pair in boundaries.windows(2) {
        let (start, end) = (pair[0], pair[1]);
        if end <= start {
            continue;
        }
        let covered = |intervals: &[(i64, i64)]| {
            intervals
                .iter()
                .any(|(left, right)| *left < end && *right > start)
        };
        let duration = end - start;
        if covered(waiting) {
            parts.waiting = parts.waiting.saturating_add(duration);
        } else {
            match (covered(model), covered(tools)) {
                (true, true) => {
                    parts.model_tool_overlap = parts.model_tool_overlap.saturating_add(duration)
                }
                (true, false) => parts.model_only = parts.model_only.saturating_add(duration),
                (false, true) => parts.tool_only = parts.tool_only.saturating_add(duration),
                (false, false) => parts.residual = parts.residual.saturating_add(duration),
            }
        }
    }
    parts
}

#[allow(clippy::too_many_arguments)]
fn add_interval(
    dashboard: &mut Dashboard,
    id: &str,
    lane: &str,
    kind: LaneKind,
    interval: Option<(i64, i64)>,
    point: Option<i64>,
    label: &str,
    status: Option<String>,
    usage: Usage,
    turn: usize,
    detail: &str,
) -> Option<usize> {
    let (start, end) = interval.or_else(|| point.map(|at| (at, at)))?;
    let index = dashboard.activities.len();
    dashboard.activities.push(Activity {
        id: id.into(),
        lane: lane.into(),
        kind,
        start,
        end,
        label: label.into(),
        status,
        usage,
        turn,
        detail: detail.into(),
    });
    Some(index)
}

#[allow(clippy::too_many_arguments)]
fn add_point(
    dashboard: &mut Dashboard,
    id: &str,
    lane: &str,
    kind: LaneKind,
    at: Option<i64>,
    label: &str,
    status: Option<String>,
    usage: Usage,
    turn: usize,
    detail: &str,
) -> Option<usize> {
    add_interval(
        dashboard, id, lane, kind, None, at, label, status, usage, turn, detail,
    )
}

fn push_lane(
    dashboard: &mut Dashboard,
    name: &str,
    kind: LaneKind,
    count: u64,
    events: Vec<usize>,
    duration_ms: Option<i64>,
    duration_stat: Option<DurationStat>,
) {
    dashboard.lanes.push(Lane {
        name: name.into(),
        kind,
        events,
        count,
        duration_ms,
        duration_stat,
    });
}

fn push_kind_lane(
    dashboard: &mut Dashboard,
    name: &str,
    kind: LaneKind,
    count: u64,
    duration_ms: Option<i64>,
    duration_stat: Option<DurationStat>,
) {
    if count == 0 {
        return;
    }
    let events = dashboard
        .activities
        .iter()
        .enumerate()
        .filter(|(_, event)| event.kind == kind)
        .map(|(index, _)| index)
        .collect();
    push_lane(
        dashboard,
        name,
        kind,
        count,
        events,
        duration_ms,
        duration_stat,
    );
}

fn session_root() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("PI_CODING_AGENT_SESSION_DIR") {
        return Ok(PathBuf::from(path));
    }
    let agent_dir = std::env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".pi/agent")))
        .context("cannot determine Pi agent directory")?;
    Ok(agent_dir.join("sessions"))
}

fn find_session(root: &Path, cwd: &Path, requested: Option<&str>) -> Result<PathBuf> {
    if let Some(requested) = requested {
        let path = PathBuf::from(requested);
        if path.is_file() {
            return Ok(path);
        }
    }
    let mut matches = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file()
            || entry.path().extension().and_then(|ext| ext.to_str()) != Some("jsonl")
        {
            continue;
        }
        if let Some(requested) = requested {
            if !entry.file_name().to_string_lossy().contains(requested)
                && read_header(entry.path())
                    .map(|header| header.0 != requested)
                    .unwrap_or(true)
            {
                continue;
            }
        } else if read_header(entry.path())
            .map(|header| !same_path(&header.1, cwd))
            .unwrap_or(true)
        {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        matches.push((modified, entry.path().to_owned()));
    }
    matches.sort_by_key(|(modified, _)| *modified);
    matches.pop().map(|(_, path)| path).with_context(|| {
        if let Some(requested) = requested {
            format!("Pi session not found: {requested}")
        } else {
            format!("no Pi sessions found for {}", cwd.display())
        }
    })
}

fn read_header(path: &Path) -> Option<(String, PathBuf)> {
    let mut file = File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.by_ref().take(16 * 1024).read_to_end(&mut bytes).ok()?;
    let line = bytes.split(|byte| *byte == b'\n').next()?;
    let value: Value = serde_json::from_slice(line).ok()?;
    Some((
        text(&value, "id")?.to_owned(),
        PathBuf::from(text(&value, "cwd")?),
    ))
}
fn same_path(left: &Path, right: &Path) -> bool {
    fs::canonicalize(left).map_or_else(|_| left == right, |left| left == right)
}

#[derive(Default)]
struct UiState {
    row: usize,
    event: usize,
    inspect: bool,
}
struct TerminalGuard;
impl TerminalGuard {
    fn enter() -> Result<Self> {
        enable_raw_mode().context("enable terminal raw mode")?;
        if let Err(error) = execute!(io::stdout(), EnterAlternateScreen) {
            let _ = disable_raw_mode();
            return Err(error).context("enter alternate screen");
        }
        Ok(Self)
    }
}
impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

pub fn run(session: Option<String>) -> Result<()> {
    if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
        bail!("agent stats requires an interactive terminal");
    }
    let cwd = fs::canonicalize(std::env::current_dir()?)?;
    let path = find_session(&session_root()?, &cwd, session.as_deref())?;
    let mut source = LiveSource::open(path)?;
    let mut dashboard = aggregate(&source.model);
    let mut state = UiState {
        row: dashboard
            .lanes
            .iter()
            .position(|lane| !lane.events.is_empty())
            .unwrap_or(0),
        ..UiState::default()
    };
    let _guard = TerminalGuard::enter()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;
    terminal.clear()?;
    let mut refreshed = Instant::now();
    loop {
        terminal.draw(|frame| render(frame, &dashboard, &state))?;
        if refreshed.elapsed() >= Duration::from_secs(1) {
            if source.read_updates()? {
                dashboard = aggregate(&source.model);
                clamp_selection(&dashboard, &mut state);
            }
            refreshed = Instant::now();
        }
        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        let TerminalEvent::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        if state.inspect {
            if matches!(key.code, KeyCode::Esc | KeyCode::Enter) {
                state.inspect = false;
            }
            continue;
        }
        match key.code {
            KeyCode::Char('q') => break,
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => break,
            KeyCode::Up => {
                state.row = state.row.saturating_sub(1);
                state.event = 0;
            }
            KeyCode::Down => {
                state.row = (state.row + 1).min(dashboard.lanes.len().saturating_sub(1));
                state.event = 0;
            }
            KeyCode::Left => state.event = state.event.saturating_sub(1),
            KeyCode::Right => {
                let count = dashboard
                    .lanes
                    .get(state.row)
                    .map_or(0, |lane| lane.events.len());
                state.event = (state.event + 1).min(count.saturating_sub(1));
            }
            KeyCode::Enter if selected_activity(&dashboard, &state).is_some() => {
                state.inspect = true;
            }
            _ => {}
        }
    }
    Ok(())
}
fn clamp_selection(dashboard: &Dashboard, state: &mut UiState) {
    state.row = state.row.min(dashboard.lanes.len().saturating_sub(1));
    let count = dashboard
        .lanes
        .get(state.row)
        .map_or(0, |lane| lane.events.len());
    state.event = state.event.min(count.saturating_sub(1));
}
fn selected_activity<'a>(dashboard: &'a Dashboard, state: &UiState) -> Option<&'a Activity> {
    dashboard
        .lanes
        .get(state.row)?
        .events
        .get(state.event)
        .and_then(|index| dashboard.activities.get(*index))
}

const MAX_DASHBOARD_WIDTH: u16 = 200;
const LABEL_WIDTH: usize = 18;
const SUMMARY_WIDTH: usize = 22;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ActivityRow {
    Group { name: &'static str },
    Lane { lane_index: usize, depth: usize },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TimelineGeometry {
    label_width: usize,
    plot_width: usize,
    summary_width: usize,
}

impl TimelineGeometry {
    fn new(width: u16) -> Self {
        Self {
            label_width: LABEL_WIDTH,
            plot_width: (width as usize)
                .saturating_sub(LABEL_WIDTH + SUMMARY_WIDTH)
                .max(1),
            summary_width: SUMMARY_WIDTH,
        }
    }

    fn width(self) -> usize {
        self.label_width + self.plot_width + self.summary_width
    }
}

fn activity_rows(lanes: &[Lane]) -> Vec<ActivityRow> {
    let mut rows = Vec::with_capacity(lanes.len() + 4);
    let mut previous_group = None;
    for (lane_index, lane) in lanes.iter().enumerate() {
        let group = match lane.kind {
            LaneKind::Turns | LaneKind::User => "RUN",
            LaneKind::Generation => "MODEL",
            LaneKind::Tool => "TOOLS",
            LaneKind::Compaction | LaneKind::Auxiliary | LaneKind::UnmatchedResult => "SYSTEM",
        };
        if previous_group != Some(group) {
            rows.push(ActivityRow::Group { name: group });
        }
        rows.push(ActivityRow::Lane {
            lane_index,
            depth: 1,
        });
        previous_group = Some(group);
    }
    rows
}

fn render(frame: &mut ratatui::Frame<'_>, dashboard: &Dashboard, state: &UiState) {
    let viewport = frame.area();
    if viewport.width < 80 || viewport.height < 34 {
        frame.render_widget(
            Paragraph::new("Terminal too small for stats view").alignment(Alignment::Center),
            viewport,
        );
        return;
    }
    let width = viewport.width.saturating_sub(8).min(MAX_DASHBOARD_WIDTH);
    let x = viewport.x + (viewport.width - width) / 2;
    let area = Rect::new(x, viewport.y, width, viewport.height);
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(17),
            Constraint::Length(1),
            Constraint::Min(12),
            Constraint::Length(1),
        ])
        .split(area);
    render_header(frame, sections[0], dashboard);
    render_stats(frame, sections[1], dashboard);
    frame.render_widget(
        Paragraph::new("─".repeat(width as usize)).style(Style::default().fg(TRACK)),
        sections[2],
    );
    render_timeline(frame, sections[3], dashboard, state);
    let diagnostics = if dashboard.diagnostics.issue_count() > 0 {
        format!(
            "  · telemetry incomplete ({})",
            diagnostic_summary(&dashboard.diagnostics)
        )
    } else if dashboard.provisional {
        "  · provisional".into()
    } else {
        String::new()
    };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                " ↑/↓ rows  ←/→ events  Enter inspect  q quit",
                Style::default().fg(MUTED),
            ),
            Span::styled(diagnostics, Style::default().fg(ORANGE)),
            Span::styled(
                format!("  · {}", short_id(&dashboard.session_id)),
                Style::default().fg(TRACK),
            ),
        ])),
        sections[4],
    );
    if state.inspect
        && let Some(activity) = selected_activity(dashboard, state)
    {
        render_inspector(frame, area, dashboard, activity);
    }
}

fn render_header(frame: &mut ratatui::Frame<'_>, area: Rect, dashboard: &Dashboard) {
    let status = if dashboard.provisional {
        "provisional"
    } else {
        "observed"
    };
    let gap = area.width.saturating_sub(8 + status.len() as u16) as usize;
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                "▟▙",
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
            ))
            .alignment(Alignment::Center),
            Line::from(Span::styled(
                "dev agent stats",
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
            ))
            .alignment(Alignment::Center),
            Line::from(vec![
                Span::styled(
                    "⌄  Stats",
                    Style::default().fg(MUTED).add_modifier(Modifier::BOLD),
                ),
                Span::raw(" ".repeat(gap)),
                Span::styled(status, Style::default().fg(BLUE)),
            ]),
        ]),
        area,
    );
}

fn render_stats(frame: &mut ratatui::Frame<'_>, area: Rect, dashboard: &Dashboard) {
    let inner_width = area.width.saturating_sub(6).min(124);
    let inner = Rect::new(
        area.x + (area.width - inner_width) / 2,
        area.y,
        inner_width,
        area.height,
    );
    let body_height = inner.height.saturating_sub(3);
    let body = Rect::new(inner.x, inner.y, inner.width, body_height);
    let hints = Rect::new(
        inner.x,
        inner.y + body_height,
        inner.width,
        inner.height - body_height,
    );
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(46),
            Constraint::Percentage(8),
            Constraint::Percentage(46),
        ])
        .split(body);
    let m = &dashboard.metrics;
    let lw = cols[0].width as usize;
    let rw = cols[2].width as usize;
    let mut left = vec![
        heading("SESSION"),
        stat(
            "  elapsed",
            m.wall_ms.map(format_duration).unwrap_or_else(|| "—".into()),
            Color::White,
            lw,
        ),
        stat("  turns", m.turns.to_string(), Color::White, lw),
        stat("  model calls", m.generation_count.to_string(), GREEN, lw),
        stat("  tool calls", m.tool_call_count.to_string(), ORANGE, lw),
        Line::raw(""),
        heading("WHERE TIME WENT"),
    ];
    push_time_share(&mut left, "  model", m.model_only_ms, m.wall_ms, GREEN, lw);
    push_time_share(&mut left, "  tools", m.tool_only_ms, m.wall_ms, ORANGE, lw);
    push_time_share(
        &mut left,
        "  model + tools",
        m.model_tool_overlap_ms,
        m.wall_ms,
        MINT,
        lw,
    );
    push_time_share(
        &mut left,
        "  idle / waiting",
        m.waiting_ms,
        m.wall_ms,
        MUTED,
        lw,
    );
    push_time_share(
        &mut left,
        "  unaccounted",
        m.residual_ms,
        m.wall_ms,
        PURPLE,
        lw,
    );

    let mut right = vec![
        heading("MODEL"),
        stat("  calls", m.generation_count.to_string(), Color::White, rw),
    ];
    push_duration(&mut right, "  active time", m.model_wall_ms, GREEN, rw);
    push_duration(&mut right, "  avg", m.model_avg_ms, GREEN, rw);
    push_duration(&mut right, "  p95", m.model_p95_ms, GREEN, rw);
    right.push(Line::raw(""));
    right.push(heading("TOOLS"));
    right.push(stat(
        "  calls",
        m.tool_call_count.to_string(),
        Color::White,
        rw,
    ));
    push_duration(&mut right, "  active time", m.tool_wall_ms, ORANGE, rw);
    push_duration(
        &mut right,
        "  summed runtime",
        m.tool_cumulative_ms,
        ORANGE,
        rw,
    );
    push_duration(
        &mut right,
        "  parallel overlap",
        m.tool_overlap_ms,
        ORANGE,
        rw,
    );
    push_duration(&mut right, "  avg", m.tool_avg_ms, ORANGE, rw);
    push_duration(&mut right, "  p95", m.tool_p95_ms, ORANGE, rw);
    frame.render_widget(Paragraph::new(left), cols[0]);
    frame.render_widget(Paragraph::new(right), cols[2]);
    frame.render_widget(
        Paragraph::new(vec![
            Line::styled(
                "? active time: at least one call was running",
                Style::default().fg(MUTED),
            ),
            Line::styled(
                "? summed runtime: total of each call · overlap: concurrent calls",
                Style::default().fg(MUTED),
            ),
            Line::styled(
                "? p95: 95% finished within · unaccounted: unattributed time",
                Style::default().fg(MUTED),
            ),
        ]),
        hints,
    );
}
fn heading(text: &'static str) -> Line<'static> {
    Line::from(Span::styled(
        text,
        Style::default()
            .fg(Color::White)
            .add_modifier(Modifier::BOLD),
    ))
}
fn push_duration(
    lines: &mut Vec<Line<'static>>,
    label: &'static str,
    value: Option<i64>,
    color: Color,
    width: usize,
) {
    if let Some(value) = value {
        lines.push(stat(label, format_duration(value), color, width));
    }
}
fn push_time_share(
    lines: &mut Vec<Line<'static>>,
    label: &'static str,
    value: Option<i64>,
    total: Option<i64>,
    color: Color,
    width: usize,
) {
    if let Some(value) = value {
        let percent = match total.filter(|total| *total > 0) {
            Some(total) if value > 0 && (value as i128) * 100 < total as i128 => "<1%".into(),
            Some(total) => format!(
                "{}%",
                ((value as i128) * 100 + total as i128 / 2) / total as i128
            ),
            None => "—".into(),
        };
        lines.push(stat(
            label,
            format!("{}  {percent:>3}", format_duration(value)),
            color,
            width,
        ));
    }
}

fn stat(label: &'static str, value: String, color: Color, width: usize) -> Line<'static> {
    let value_width = value.chars().count();
    let label_width = width.saturating_sub(value_width).max(label.len() + 1);
    let value_style = if value == "—" {
        Style::default().fg(TRACK)
    } else {
        Style::default().fg(color).add_modifier(Modifier::BOLD)
    };
    Line::from(vec![
        Span::styled(format!("{label:<label_width$}"), Style::default().fg(MUTED)),
        Span::styled(value, value_style),
    ])
}

fn render_timeline(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    dashboard: &Dashboard,
    state: &UiState,
) {
    let geometry = TimelineGeometry::new(area.width);
    let rows = activity_rows(&dashboard.lanes);
    let row_capacity = area.height.saturating_sub(4) as usize;
    let selected_row = rows
        .iter()
        .position(
            |row| matches!(row, ActivityRow::Lane { lane_index, .. } if *lane_index == state.row),
        )
        .unwrap_or(0);
    let scroll = selected_row.saturating_sub(row_capacity.saturating_sub(2));
    let elapsed = dashboard
        .metrics
        .wall_ms
        .map(format_duration)
        .unwrap_or_else(|| "unavailable".into());
    let range = format!(
        "{} → {} · {elapsed}",
        clock(dashboard.start),
        clock(dashboard.end)
    );
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                "⌄  Timeline",
                Style::default().fg(MUTED).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" ".repeat(area.width.saturating_sub(12 + range.len() as u16) as usize)),
            Span::styled(range, Style::default().fg(MUTED)),
        ]),
        timeline_color_legend(),
        timeline_axis(geometry, dashboard.metrics.wall_ms),
        timeline_guides(geometry, dashboard.metrics.wall_ms),
    ];
    for row in rows.iter().skip(scroll).take(row_capacity) {
        let line = match *row {
            ActivityRow::Group { name } => group_line(name, geometry),
            ActivityRow::Lane { lane_index, depth } => {
                let selected = lane_index == state.row;
                render_lane(
                    &dashboard.lanes[lane_index],
                    dashboard,
                    geometry,
                    depth,
                    lane_index % 2 == 1,
                    selected,
                    selected.then_some(state.event),
                )
            }
        };
        lines.push(line);
    }
    frame.render_widget(Paragraph::new(lines), area);
}

fn timeline_color_legend() -> Line<'static> {
    Line::from(vec![
        Span::styled("   green", Style::default().fg(GREEN)),
        Span::styled(" model     ", Style::default().fg(MUTED)),
        Span::styled("orange", Style::default().fg(ORANGE)),
        Span::styled(" tools     ", Style::default().fg(MUTED)),
        Span::styled("purple", Style::default().fg(PURPLE)),
        Span::styled(" compaction     ", Style::default().fg(MUTED)),
        Span::styled("gray", Style::default().fg(MUTED)),
        Span::styled(" run/user", Style::default().fg(MUTED)),
    ])
}

fn timeline_guides(geometry: TimelineGeometry, wall_ms: Option<i64>) -> Line<'static> {
    let raster_width = geometry.plot_width;
    let mut cells = vec![' '; raster_width];
    for (position, _) in time_ticks(raster_width, wall_ms) {
        cells[position] = '┊';
    }
    Line::from(vec![
        Span::styled(
            format!(
                "{:>width$}┊",
                "time grid ",
                width = geometry.label_width - 1
            ),
            Style::default().fg(GRID),
        ),
        Span::styled(
            cells.into_iter().collect::<String>(),
            Style::default().fg(GRID),
        ),
        Span::styled(
            format!("┊{}", " ".repeat(geometry.summary_width - 1)),
            Style::default().fg(GRID),
        ),
    ])
}

fn group_line(name: &'static str, geometry: TimelineGeometry) -> Line<'static> {
    let label = format!("  {name}");
    let label = format!(
        "{:<width$}├",
        truncate_right(&label, geometry.label_width - 1),
        width = geometry.label_width - 1
    );
    Line::from(vec![
        Span::styled(
            label,
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled("─".repeat(geometry.plot_width), Style::default().fg(TRACK)),
        Span::styled(
            format!("┤{}", "─".repeat(geometry.summary_width - 1)),
            Style::default().fg(TRACK),
        ),
    ])
}

fn time_ticks(graph_width: usize, wall_ms: Option<i64>) -> Vec<(usize, i64)> {
    let total = wall_ms.unwrap_or(0).max(0);
    if total == 0 || graph_width <= 1 {
        return vec![(0, 0)];
    }
    const STEPS: &[i64] = &[
        1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
        1_800_000, 3_600_000, 7_200_000, 14_400_000, 21_600_000, 43_200_000,
    ];
    let target = total / if graph_width >= 70 { 6 } else { 4 };
    let step = STEPS
        .iter()
        .copied()
        .find(|step| *step >= target)
        .unwrap_or(total.max(1));
    let mut ticks = Vec::new();
    let mut at = 0;
    while at <= total {
        ticks.push((
            (at as i128 * (graph_width - 1) as i128 / total as i128) as usize,
            at,
        ));
        at = at.saturating_add(step);
    }
    ticks
}

fn timeline_axis(geometry: TimelineGeometry, wall_ms: Option<i64>) -> Line<'static> {
    let graph_width = geometry.plot_width;
    let mut cells = vec![' '; graph_width];
    for (position, at) in time_ticks(graph_width, wall_ms) {
        let label = axis_duration(at);
        let start = position
            .saturating_sub(label.len() / 2)
            .min(graph_width.saturating_sub(label.len()));
        for (offset, ch) in label
            .chars()
            .enumerate()
            .take(graph_width.saturating_sub(start))
        {
            cells[start + offset] = ch;
        }
    }
    Line::from(vec![
        Span::styled(
            format!("{:>width$}│", "lane ", width = geometry.label_width - 1),
            Style::default().fg(MUTED).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            cells.into_iter().collect::<String>(),
            Style::default().fg(GRID).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("│  {:>5} {:>13}", "calls", "runtime"),
            Style::default().fg(MUTED).add_modifier(Modifier::BOLD),
        ),
    ])
}

fn render_lane(
    lane: &Lane,
    dashboard: &Dashboard,
    geometry: TimelineGeometry,
    depth: usize,
    alternate: bool,
    selected: bool,
    selected_event: Option<usize>,
) -> Line<'static> {
    let bucket_count = geometry.plot_width;
    let mut cells = vec!['·'; bucket_count];
    let mut colors = vec![TRACK; bucket_count];
    let mut highlights = vec![false; bucket_count];
    let mut density = vec![0.0; bucket_count];
    for (position, _) in time_ticks(bucket_count, dashboard.metrics.wall_ms) {
        cells[position] = '┊';
        colors[position] = GRID;
    }

    if lane.kind == LaneKind::Turns {
        cells.fill('─');
        colors.fill(MUTED);
        for (number, at) in dashboard.turn_starts.iter().enumerate() {
            let start = scale_point(*at, dashboard.start, dashboard.end, bucket_count);
            let end = dashboard
                .turn_starts
                .get(number + 1)
                .map(|at| scale_point(*at, dashboard.start, dashboard.end, bucket_count))
                .unwrap_or(bucket_count - 1);
            cells[start] = '├';
            let label = format!(" {} ", number + 1);
            let label_start = start + end.saturating_sub(start + label.len()) / 2;
            for (offset, ch) in label.chars().enumerate() {
                if label_start + offset < end {
                    cells[label_start + offset] = ch;
                }
            }
            if end < bucket_count {
                cells[end] = '┼';
            }
        }
        cells[bucket_count - 1] = '┤';
    } else {
        density = activity_density(lane, dashboard, bucket_count);
        for (index, load) in density.iter().copied().enumerate() {
            if load > 0.0 {
                cells[index] = activity_glyph(load);
                colors[index] = lane_color(lane.kind);
            }
        }

        if let Some(position) = selected_event
            && let Some(index) = lane.events.get(position)
        {
            let event = &dashboard.activities[*index];
            let (start, end) = scale_interval(
                event.start,
                event.end,
                dashboard.start,
                dashboard.end,
                bucket_count,
            );
            for value in &mut highlights[start..=end] {
                *value = true;
            }
        }
    }

    let row_background = if selected {
        Some(Color::Rgb(51, 65, 85))
    } else if alternate {
        Some(Color::Rgb(15, 23, 42))
    } else {
        None
    };
    let prefix = if selected { "› " } else { "  " };
    let indent = "  ".repeat(depth);
    let available = geometry
        .label_width
        .saturating_sub(1 + prefix.chars().count() + indent.chars().count());
    let label = truncate_right(&lane.name, available);
    let label_cell = format!(
        "{prefix}{indent}{label:<available$}│",
        available = available
    );
    let mut label_style = Style::default()
        .fg(if selected { Color::White } else { MUTED })
        .add_modifier(if selected {
            Modifier::BOLD
        } else {
            Modifier::empty()
        });
    if let Some(background) = row_background {
        label_style = label_style.bg(background);
    }
    let mut spans = vec![Span::styled(label_cell, label_style)];
    for index in 0..bucket_count {
        let mut style = Style::default().fg(colors[index]);
        if density[index] > 1.0 + 1e-9 {
            style = style.add_modifier(Modifier::BOLD);
        }
        if let Some(background) = row_background {
            style = style.bg(background);
        }
        if highlights[index] {
            style = style
                .bg(Color::Rgb(71, 85, 105))
                .add_modifier(Modifier::BOLD);
        }
        spans.push(Span::styled(cells[index].to_string(), style));
    }
    let duration = match (lane.duration_stat, lane.duration_ms) {
        (Some(DurationStat::ObservedWall | DurationStat::Cumulative), Some(value)) => {
            format_duration(value)
        }
        _ => String::new(),
    };
    let count = truncate_left(&compact(lane.count), 5);
    let duration = truncate_left(&duration, 13);
    let mut summary_style = Style::default()
        .fg(if selected { Color::White } else { MUTED })
        .add_modifier(if selected {
            Modifier::BOLD
        } else {
            Modifier::empty()
        });
    if let Some(background) = row_background {
        summary_style = summary_style.bg(background);
    }
    spans.push(Span::styled(
        format!("│  {count:>5} {duration:>13}"),
        summary_style,
    ));
    debug_assert_eq!(
        spans
            .iter()
            .map(|span| span.content.chars().count())
            .sum::<usize>(),
        geometry.width()
    );
    Line::from(spans)
}

fn activity_density(lane: &Lane, dashboard: &Dashboard, width: usize) -> Vec<f64> {
    let mut density = vec![0.0; width];
    let (Some(session_start), Some(session_end)) = (dashboard.start, dashboard.end) else {
        return density;
    };
    let session_duration = session_end.saturating_sub(session_start);
    if width == 0 || session_duration <= 0 {
        return density;
    }
    let cell_duration = session_duration as f64 / width as f64;

    for event_index in &lane.events {
        let event = &dashboard.activities[*event_index];
        if event.end <= event.start {
            let offset = event
                .start
                .saturating_sub(session_start)
                .clamp(0, session_duration);
            let cell = ((offset as i128 * width as i128) / session_duration as i128)
                .min(width.saturating_sub(1) as i128) as usize;
            density[cell] += 0.125;
            continue;
        }

        let start = event.start.clamp(session_start, session_end);
        let end = event.end.clamp(session_start, session_end);
        if end <= start {
            continue;
        }
        let start_offset = (start - session_start) as f64;
        let end_offset = (end - session_start) as f64;
        let first = ((start_offset / session_duration as f64) * width as f64).floor() as usize;
        let last_exclusive =
            (((end_offset / session_duration as f64) * width as f64).ceil() as usize).min(width);
        for (cell, load) in density
            .iter_mut()
            .enumerate()
            .take(last_exclusive)
            .skip(first.min(width - 1))
        {
            let cell_start = cell as f64 * cell_duration;
            let cell_end = cell_start + cell_duration;
            let overlap = end_offset.min(cell_end) - start_offset.max(cell_start);
            if overlap > 0.0 {
                *load += overlap / cell_duration;
            }
        }
    }
    density
}

fn activity_glyph(load: f64) -> char {
    const PARTIAL_BLOCKS: [char; 7] = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];
    if load <= 0.0 {
        '·'
    } else if load >= 1.0 - 1e-9 {
        '█'
    } else {
        let eighths = (load * 8.0).round().clamp(1.0, 7.0) as usize;
        PARTIAL_BLOCKS[eighths - 1]
    }
}

fn lane_color(kind: LaneKind) -> Color {
    match kind {
        LaneKind::Generation | LaneKind::Auxiliary => GREEN,
        LaneKind::Tool | LaneKind::UnmatchedResult => ORANGE,
        LaneKind::Compaction => PURPLE,
        LaneKind::Turns | LaneKind::User => MUTED,
    }
}

fn scale_point(at: i64, start: Option<i64>, end: Option<i64>, width: usize) -> usize {
    let (Some(start), Some(end)) = (start, end) else {
        return 0;
    };
    if width <= 1 || end <= start {
        return 0;
    }
    (((at.saturating_sub(start).max(0) as i128) * (width - 1) as i128) / (end - start) as i128)
        .clamp(0, (width - 1) as i128) as usize
}
fn scale_interval(
    start_at: i64,
    end_at: i64,
    start: Option<i64>,
    end: Option<i64>,
    width: usize,
) -> (usize, usize) {
    let (Some(start), Some(end)) = (start, end) else {
        return (0, 0);
    };
    let duration = end.saturating_sub(start);
    if width <= 1 || duration <= 0 {
        return (0, 0);
    }
    let offset = start_at.saturating_sub(start).clamp(0, duration);
    let first = ((offset as i128 * width as i128) / duration as i128)
        .min(width.saturating_sub(1) as i128) as usize;
    if end_at <= start_at {
        return (first, first);
    }
    let end_offset = end_at.saturating_sub(start).clamp(0, duration);
    let end_boundary = ((end_offset as i128 * width as i128 + duration as i128 - 1)
        / duration as i128)
        .min(width as i128) as usize;
    (first, end_boundary.saturating_sub(1).max(first))
}

fn render_inspector(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    dashboard: &Dashboard,
    event: &Activity,
) {
    let width = area.width.min(76);
    let height = area.height.min(30);
    let popup = Rect::new(
        area.x + (area.width - width) / 2,
        area.y + (area.height - height) / 2,
        width,
        height,
    );
    let m = &dashboard.metrics;
    let usage = event.usage;
    let normalized = usage.normalize();
    let lines = vec![
        heading("EVENT"),
        inspection_line(
            "id",
            if event.id.is_empty() {
                "unavailable"
            } else {
                &event.id
            },
        ),
        inspection_line("type", &event.label),
        inspection_line("lane", &event.lane),
        inspection_line("start", &timestamp_text(event.start)),
        inspection_line("end", &timestamp_text(event.end)),
        inspection_line(
            "duration",
            &format_duration(event.end.saturating_sub(event.start)),
        ),
        inspection_line(
            "status / turn",
            &format!(
                "{} / {}",
                event.status.as_deref().unwrap_or("recorded"),
                event.turn
            ),
        ),
        Line::styled(event.detail.clone(), Style::default().fg(Color::White)),
        Line::raw(""),
        heading("EXACT ACCOUNTING"),
        inspection_line(
            "model",
            &format!(
                "wall occupancy {} · cumulative {}",
                optional_duration(m.model_wall_ms),
                optional_duration(m.model_cumulative_ms)
            ),
        ),
        inspection_line(
            "tools",
            &format!(
                "wall occupancy {} · cumulative {}",
                optional_duration(m.tool_wall_ms),
                optional_duration(m.tool_cumulative_ms)
            ),
        ),
        inspection_line("tool overlap", &optional_duration(m.tool_overlap_ms)),
        inspection_line(
            "wall split",
            &format!(
                "model {} · tools {} · both {}",
                optional_duration(m.model_only_ms),
                optional_duration(m.tool_only_ms),
                optional_duration(m.model_tool_overlap_ms)
            ),
        ),
        inspection_line(
            "remainder",
            &format!(
                "waiting {} · residual {}",
                optional_duration(m.waiting_ms),
                optional_duration(m.residual_ms)
            ),
        ),
        inspection_line(
            "timed calls",
            &format!(
                "model {}/{} · tools {}/{} completed ({} open)",
                m.timed_generation_count,
                m.generation_count,
                m.timed_tool_count,
                m.completed_tool_count,
                m.open_tool_count
            ),
        ),
        inspection_line(
            "telemetry",
            &if dashboard.diagnostics.issue_count() == 0 {
                "complete".into()
            } else {
                diagnostic_summary(&dashboard.diagnostics)
            },
        ),
        inspection_line(
            "session tokens",
            &m.usage
                .map(|usage| {
                    format!(
                        "input {} · output {} · total {}",
                        usage.input, usage.output, usage.total
                    )
                })
                .unwrap_or_else(|| "unavailable".into()),
        ),
        inspection_line(
            "session prompt",
            &m.usage
                .map(|usage| {
                    format!(
                        "computed {} · cache read {} · reasoning {}",
                        usage.computed_prompt,
                        usage.cached_prompt,
                        usage
                            .reasoning
                            .map(compact)
                            .unwrap_or_else(|| "unavailable".into())
                    )
                })
                .unwrap_or_else(|| "unavailable".into()),
        ),
        Line::raw(""),
        heading("EVENT TOKENS (RAW → NORMALIZED)"),
        inspection_line(
            "prompt",
            &format!(
                "input {} · cache read {} · cache write {}",
                optional_count(usage.input),
                optional_count(usage.cache_read),
                optional_count(usage.cache_write)
            ),
        ),
        inspection_line(
            "response",
            &format!(
                "output {} · reasoning {} · provider total {}",
                optional_count(usage.output),
                optional_count(usage.reasoning),
                optional_count(usage.provider_total)
            ),
        ),
        inspection_line(
            "normalized",
            &normalized
                .map(|usage| {
                    format!(
                        "input {} · output {} · total {}",
                        usage.input, usage.output, usage.total
                    )
                })
                .unwrap_or_else(|| "unavailable".into()),
        ),
        Line::styled(
            "normalized input = input + cache write + cache read",
            Style::default().fg(MUTED),
        ),
        Line::raw(""),
        Line::styled("Esc close", Style::default().fg(MUTED)),
    ];
    frame.render_widget(Clear, popup);
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::default()
                .title(" Inspect ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(MUTED)),
        ),
        popup,
    );
}

fn inspection_line(label: &str, value: &str) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label:<14}"), Style::default().fg(MUTED)),
        Span::raw(value.to_owned()),
    ])
}

fn optional_duration(value: Option<i64>) -> String {
    value
        .map(format_duration)
        .unwrap_or_else(|| "unavailable".into())
}

fn optional_count(value: Option<u64>) -> String {
    value.map(compact).unwrap_or_else(|| "unavailable".into())
}

fn diagnostic_summary(diagnostics: &Diagnostics) -> String {
    let mut parts = Vec::new();
    let mut add = |label: &str, count: u64| {
        if count > 0 {
            parts.push(format!("{label} {count}"));
        }
    };
    add("branch", diagnostics.abandoned_branch);
    add("unknown", diagnostics.unknown_internal);
    add("malformed", diagnostics.malformed);
    add("invalid", diagnostics.invalid);
    add("unmatched", diagnostics.unmatched_results);
    add("call IDs", diagnostics.duplicate_or_invalid_call_id);
    add("timing", diagnostics.missing_timing);
    add("usage", diagnostics.missing_usage);
    add("provider totals", diagnostics.provider_total_mismatch);
    if diagnostics.incomplete_trailing {
        parts.push("trailing line 1".into());
    }
    parts.join(", ")
}

fn short_id(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

fn format_duration(ms: i64) -> String {
    let ms = ms.max(0);
    let seconds = ms / 1000;
    if seconds >= 3600 {
        format!("{}h{:02}m", seconds / 3600, (seconds % 3600) / 60)
    } else if seconds >= 60 {
        format!("{}m{:02}s", seconds / 60, seconds % 60)
    } else if ms < 1000 {
        format!("{ms}ms")
    } else {
        format!("{}.{:01}s", seconds, (ms % 1000) / 100)
    }
}
fn axis_duration(ms: i64) -> String {
    let seconds = ms.max(0) / 1000;
    if seconds >= 3600 {
        let hours = seconds / 3600;
        let minutes = (seconds % 3600) / 60;
        if minutes == 0 {
            format!("{hours}h")
        } else {
            format!("{hours}h{minutes:02}")
        }
    } else if seconds >= 60 {
        format!("{}m", seconds / 60)
    } else {
        format!("{}s", seconds)
    }
}
fn truncate_right(value: &str, width: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= width {
        value.to_owned()
    } else if width <= 1 {
        "…".chars().take(width).collect()
    } else {
        chars[..width - 1]
            .iter()
            .copied()
            .chain(std::iter::once('…'))
            .collect()
    }
}
fn truncate_left(value: &str, width: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= width {
        value.to_owned()
    } else if width <= 1 {
        "…".chars().take(width).collect()
    } else {
        std::iter::once('…')
            .chain(chars[chars.len() - (width - 1)..].iter().copied())
            .collect()
    }
}
fn compact(value: u64) -> String {
    if value >= 1_000_000 {
        format!("{:.1}M", value as f64 / 1_000_000.0)
    } else if value >= 1_000 {
        format!("{:.0}k", value as f64 / 1_000.0)
    } else {
        value.to_string()
    }
}
fn clock(value: Option<i64>) -> String {
    value
        .and_then(DateTime::<Utc>::from_timestamp_millis)
        .map(|time| time.with_timezone(&Local).format("%I:%M %p").to_string())
        .unwrap_or_else(|| "—".into())
}
fn timestamp_text(value: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(value)
        .map(|time| time.with_timezone(&Local).to_rfc3339())
        .unwrap_or_else(|| "—".into())
}

#[cfg(any())]
mod legacy_tests {
    use super::*;
    use std::io::Write;

    fn record(id: &str, parent: Option<&str>, at: i64, kind: RecordKind) -> Record {
        Record {
            id: id.into(),
            parent: parent.map(str::to_owned),
            at: Some(at),
            kind,
        }
    }
    fn model(records: Vec<Record>) -> SessionModel {
        SessionModel {
            id: "s".into(),
            cwd: PathBuf::from("/tmp"),
            started_at: Some(0),
            records,
            malformed: 0,
        }
    }
    fn usage(
        input: Option<u64>,
        output: Option<u64>,
        cached: Option<u64>,
        reasoning: Option<u64>,
    ) -> Usage {
        Usage {
            input,
            output,
            cache_read: cached,
            cache_write: None,
            reasoning,
            total: None,
        }
    }

    #[test]
    fn token_totals_keep_categories_distinct() {
        let dashboard = aggregate(&model(vec![
            record("u", None, 100, RecordKind::User),
            record(
                "a",
                Some("u"),
                200,
                RecordKind::Assistant {
                    model: None,
                    usage: usage(Some(10), Some(4), Some(30), Some(2)),
                    calls: vec![],
                },
            ),
        ]));
        assert_eq!(dashboard.metrics.usage.input, Some(10));
        assert_eq!(dashboard.metrics.usage.cache_read, Some(30));
        assert_eq!(dashboard.metrics.usage.output, Some(4));
        assert_eq!(dashboard.metrics.usage.reasoning, Some(2));
        assert_eq!(dashboard.metrics.usage.total, Some(44));
    }
    #[test]
    fn missing_tokens_stay_unavailable() {
        assert_eq!(opt_tokens(Usage::default().accounted_total()), "—");
    }
    #[test]
    fn tool_result_usage_is_counted_once_and_separate() {
        let call = ToolCall {
            id: "c".into(),
            name: "read".into(),
            summary: String::new(),
        };
        let dashboard = aggregate(&model(vec![
            record("u", None, 1, RecordKind::User),
            record(
                "a",
                Some("u"),
                10,
                RecordKind::Assistant {
                    model: None,
                    usage: usage(Some(5), Some(2), None, None),
                    calls: vec![call],
                },
            ),
            record(
                "t",
                Some("a"),
                20,
                RecordKind::ToolResult {
                    call_id: "c".into(),
                    name: Some("read".into()),
                    failed: Some(false),
                    usage: usage(Some(3), Some(1), None, None),
                },
            ),
        ]));
        assert_eq!(dashboard.metrics.usage.input, Some(8));
        assert_eq!(dashboard.metrics.tool_result_tokens, None);
    }
    #[test]
    fn wall_clock_uses_timestamps_not_category_sums() {
        let dashboard = aggregate(&model(vec![
            record("u", None, 10, RecordKind::User),
            record(
                "a",
                Some("u"),
                100,
                RecordKind::Assistant {
                    model: None,
                    usage: Usage::default(),
                    calls: vec![],
                },
            ),
        ]));
        assert_eq!(dashboard.metrics.wall_ms, Some(100));
    }
    #[test]
    fn overlapping_intervals_remain_overlapping() {
        assert_eq!(scale_interval(10, 60, Some(0), Some(100), 11), (1, 6));
        assert_eq!(scale_interval(40, 80, Some(0), Some(100), 11), (4, 8));
    }
    #[test]
    fn overlapping_tool_durations_are_not_double_counted() {
        assert_eq!(union_duration(vec![(10, 60), (40, 80), (90, 100)]), 80);
    }
    #[test]
    fn minimum_width_point_is_one_cell() {
        assert_eq!(scale_interval(50, 50, Some(0), Some(100), 21), (10, 10));
    }
    #[test]
    fn open_tool_call_is_visible_and_running() {
        let call = ToolCall {
            id: "c".into(),
            name: "bash".into(),
            summary: "x".into(),
        };
        let dashboard = aggregate(&model(vec![
            record("u", None, 1, RecordKind::User),
            record(
                "a",
                Some("u"),
                2,
                RecordKind::Assistant {
                    model: None,
                    usage: Usage::default(),
                    calls: vec![call],
                },
            ),
        ]));
        assert!(dashboard.activities.iter().any(|event| event.status.as_deref() == Some("running") && event.start == event.end));
    }
    #[test]
    fn laps_partition_wall_clock_and_use_one_population() {
        let dashboard = aggregate(&model(vec![
            record("u1", None, 10, RecordKind::User),
            record(
                "a1",
                Some("u1"),
                20,
                RecordKind::Assistant {
                    model: None,
                    usage: Usage::default(),
                    calls: vec![],
                },
            ),
            record("u2", Some("a1"), 30, RecordKind::User),
            record(
                "a2",
                Some("u2"),
                50,
                RecordKind::Assistant {
                    model: None,
                    usage: Usage::default(),
                    calls: vec![],
                },
            ),
        ]));
        assert_eq!(dashboard.metrics.laps, 2);
        assert_eq!(dashboard.metrics.wall_ms, Some(50));
        assert_eq!(dashboard.metrics.avg_lap_ms, Some(25));
        assert_eq!(dashboard.lap_starts, vec![0, 30]);
    }
    #[test]
    fn aggregate_total_uses_per_record_provider_total_or_fallback() {
        let first = Usage {
            input: Some(10),
            output: Some(2),
            cache_read: Some(80),
            total: Some(100),
            ..Usage::default()
        };
        let second = usage(Some(5), Some(2), None, None);
        let dashboard = aggregate(&model(vec![
            record("u", None, 1, RecordKind::User),
            record(
                "a",
                Some("u"),
                2,
                RecordKind::Assistant {
                    model: None,
                    usage: first,
                    calls: vec![],
                },
            ),
            record("x", Some("a"), 3, RecordKind::Usage(second)),
        ]));
        assert_eq!(dashboard.metrics.usage.total, Some(107));
    }
    #[test]
    fn idless_tail_does_not_pull_abandoned_branches_into_active_path() {
        let session = model(vec![
            record("u", None, 1, RecordKind::User),
            record("old", Some("u"), 2, RecordKind::User),
            record(
                "new",
                Some("u"),
                3,
                RecordKind::Assistant {
                    model: None,
                    usage: usage(Some(7), None, None, None),
                    calls: vec![],
                },
            ),
            record("", None, 4, RecordKind::Other),
        ]);
        let dashboard = aggregate(&session);
        assert_eq!(dashboard.metrics.laps, 1);
        assert_eq!(dashboard.metrics.usage.input, Some(7));
    }
    #[test]
    fn tool_calls_aggregate_by_name() {
        let calls = vec![
            ToolCall {
                id: "1".into(),
                name: "read".into(),
                summary: String::new(),
            },
            ToolCall {
                id: "2".into(),
                name: "read".into(),
                summary: String::new(),
            },
        ];
        let dashboard = aggregate(&model(vec![
            record("u", None, 1, RecordKind::User),
            record(
                "a",
                Some("u"),
                2,
                RecordKind::Assistant {
                    model: None,
                    usage: Usage::default(),
                    calls,
                },
            ),
        ]));
        assert_eq!(
            dashboard
                .lanes
                .iter()
                .find(|lane| lane.name == "read")
                .unwrap()
                .count,
            Some(2)
        );
    }
    #[test]
    fn unknown_records_do_not_affect_metrics() {
        let dashboard = aggregate(&model(vec![record("x", None, 1, RecordKind::Other)]));
        assert_eq!(dashboard.metrics.activity_count, 0);
    }
    #[test]
    fn empty_session_is_supported() {
        let dashboard = aggregate(&model(vec![]));
        assert_eq!(dashboard.metrics.laps, 0);
        assert_eq!(dashboard.metrics.wall_ms, None);
    }
    #[test]
    fn ttft_is_unavailable_without_direct_provider_data() {
        assert_eq!(aggregate(&model(vec![])).metrics.first_token_ms, None);
    }
    #[test]
    fn active_branch_excludes_abandoned_branch() {
        let m = model(vec![
            record("u", None, 1, RecordKind::User),
            record("old", Some("u"), 2, RecordKind::User),
            record(
                "new",
                Some("u"),
                3,
                RecordKind::Assistant {
                    model: None,
                    usage: usage(Some(7), None, None, None),
                    calls: vec![],
                },
            ),
        ]);
        let dashboard = aggregate(&m);
        assert_eq!(dashboard.metrics.laps, 1);
        assert_eq!(dashboard.metrics.usage.input, Some(7));
    }
    #[test]
    fn row_summary_is_visible_without_selection() {
        let dashboard = Dashboard {
            start: Some(0),
            end: Some(300_000),
            metrics: Metrics {
                wall_ms: Some(300_000),
                ..Metrics::default()
            },
            ..Dashboard::default()
        };
        let lane = Lane {
            name: "bash".into(),
            kind: LaneKind::Tool,
            events: vec![],
            count: Some(32),
            duration_ms: Some(285_000),
        };
        let line = render_lane(&lane, &dashboard, 120, false, None);
        let text = line
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();
        assert!(text.contains("32"));
        assert!(text.contains("4m45s"));
    }
    #[test]
    fn bucket_raster_preserves_long_occupancy_and_idle_time() {
        let activity = Activity {
            lane: "bash".into(),
            kind: LaneKind::Tool,
            start: 200,
            end: 800,
            label: "bash".into(),
            status: None,
            usage: Usage::default(),
            lap: 1,
            detail: String::new(),
        };
        let dashboard = Dashboard {
            start: Some(0),
            end: Some(1_000),
            activities: vec![activity],
            ..Dashboard::default()
        };
        let lane = Lane {
            name: "bash".into(),
            kind: LaneKind::Tool,
            events: vec![0],
            count: Some(1),
            duration_ms: Some(600),
        };
        let scores = bucket_scores(&lane, &dashboard, 10);
        assert_eq!(scores[0], 0.0);
        assert!(scores[2..8].iter().all(|score| *score > 0.0));
        assert_eq!(scores[9], 0.0);
    }
    #[test]
    fn point_activity_is_coarsened_without_filling_idle_regions() {
        let activity = Activity {
            lane: "generation".into(),
            kind: LaneKind::Generation,
            start: 500,
            end: 500,
            label: "assistant".into(),
            status: None,
            usage: Usage::default(),
            lap: 1,
            detail: String::new(),
        };
        let dashboard = Dashboard {
            start: Some(0),
            end: Some(1_000),
            activities: vec![activity],
            ..Dashboard::default()
        };
        let lane = Lane {
            name: "generation".into(),
            kind: LaneKind::Generation,
            events: vec![0],
            count: None,
            duration_ms: None,
        };
        let scores = bucket_scores(&lane, &dashboard, 10);
        assert!(scores.iter().filter(|score| **score > 0.0).count() <= 3);
        assert_eq!(scores[0], 0.0);
        assert_eq!(scores[9], 0.0);
    }
    #[test]
    fn duration_format_is_never_ambiguous() {
        assert_eq!(format_duration(91), "91ms");
        assert_eq!(format_duration(6_100), "6.1s");
        assert_eq!(format_duration(86_000), "1m26s");
    }
    #[test]
    fn major_ticks_add_spatial_anchors() {
        let ticks = time_ticks(80, Some(30 * 60 * 1000));
        assert_eq!(
            ticks.iter().map(|(_, at)| *at).collect::<Vec<_>>(),
            vec![
                0, 300_000, 600_000, 900_000, 1_200_000, 1_500_000, 1_800_000
            ]
        );
        assert_eq!(ticks.first().unwrap().0, 0);
        assert_eq!(ticks.last().unwrap().0, 79);
    }
    #[test]
    fn wide_terminal_keeps_dashboard_bounded_and_centered() {
        let dashboard = aggregate(&model(vec![
            record("u", None, 1, RecordKind::User),
            record(
                "a",
                Some("u"),
                2,
                RecordKind::Assistant {
                    model: None,
                    usage: Usage::default(),
                    calls: vec![],
                },
            ),
        ]));
        for width in [100, 120, 140, 180, 220] {
            let backend = ratatui::backend::TestBackend::new(width, 40);
            let mut terminal = ratatui::Terminal::new(backend).unwrap();
            terminal
                .draw(|frame| render(frame, &dashboard, &UiState::default()))
                .unwrap();
            let content = &terminal.backend().buffer().content;
            let occupied: Vec<usize> = content
                .iter()
                .enumerate()
                .filter(|(_, cell)| cell.symbol() != " ")
                .map(|(index, _)| index % width as usize)
                .collect();
            let left = *occupied.iter().min().unwrap();
            let right = *occupied.iter().max().unwrap();
            assert!(right - left < MAX_DASHBOARD_WIDTH as usize);
            if width > MAX_DASHBOARD_WIDTH {
                assert!(left >= ((width - MAX_DASHBOARD_WIDTH) / 2) as usize);
            }
        }
    }
    #[test]
    fn partial_trailing_record_is_retained_until_completed() {
        let root = std::env::temp_dir().join(format!("dev-agent-stats-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join("s.jsonl");
        let mut file = File::create(&path).unwrap();
        writeln!(file, "{{\"type\":\"session\",\"id\":\"s\",\"cwd\":\"/tmp\",\"timestamp\":\"1970-01-01T00:00:00Z\"}}").unwrap();
        write!(file, "{{\"type\":\"message\"").unwrap();
        file.flush().unwrap();
        let mut source = LiveSource::open(path.clone()).unwrap();
        assert!(source.model.records.is_empty());
        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, ",\"id\":\"u\",\"parentId\":null,\"timestamp\":\"1970-01-01T00:00:01Z\",\"message\":{{\"role\":\"user\"}}}}").unwrap();
        file.flush().unwrap();
        assert!(source.read_updates().unwrap());
        assert_eq!(source.model.records.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn record(id: &str, parent: Option<&str>, at: i64, kind: RecordKind) -> Record {
        Record {
            id: id.into(),
            parent: parent.map(str::to_owned),
            at: Some(at),
            kind,
        }
    }

    fn session(records: Vec<Record>) -> SessionModel {
        SessionModel {
            id: "session".into(),
            cwd: PathBuf::from("/tmp"),
            started_at: Some(0),
            records,
            malformed: 0,
            incomplete_trailing: false,
        }
    }

    fn usage(
        input: u64,
        output: u64,
        cached: u64,
        cache_write: u64,
        reasoning: Option<u64>,
    ) -> Usage {
        Usage {
            input: Some(input),
            output: Some(output),
            cache_read: Some(cached),
            cache_write: Some(cache_write),
            reasoning,
            provider_total: None,
        }
    }

    fn assistant(started_at: Option<i64>, usage: Usage, calls: Vec<ToolCall>) -> RecordKind {
        RecordKind::Assistant {
            model: Some("model".into()),
            started_at,
            usage,
            calls,
        }
    }

    fn call(id: &str, name: &str) -> ToolCall {
        ToolCall {
            id: id.into(),
            name: name.into(),
            summary: String::new(),
        }
    }

    fn result(call_id: &str, name: &str) -> RecordKind {
        RecordKind::ToolResult {
            call_id: call_id.into(),
            name: Some(name.into()),
            failed: Some(false),
            usage: Usage::default(),
        }
    }

    fn assert_reconciles(dashboard: &Dashboard) {
        let metrics = &dashboard.metrics;
        assert_eq!(
            metrics.event_count,
            metrics.user_count
                + metrics.generation_count
                + metrics.tool_call_count
                + metrics.compaction_count
                + metrics.auxiliary_count
                + metrics.unmatched_result_count
        );
        let tool_count: u64 = dashboard
            .lanes
            .iter()
            .filter(|lane| lane.kind == LaneKind::Tool)
            .map(|lane| lane.count)
            .sum();
        assert_eq!(tool_count as usize, metrics.tool_call_count);
        if let Some(usage) = metrics.usage {
            assert_eq!(usage.input, usage.cached_prompt + usage.computed_prompt);
            assert_eq!(usage.total, usage.input + usage.output);
            assert!(
                usage
                    .reasoning
                    .is_none_or(|reasoning| reasoning <= usage.output)
            );
        }
        if let Some(wall) = metrics.wall_ms {
            assert_eq!(
                wall,
                metrics.model_only_ms.unwrap()
                    + metrics.tool_only_ms.unwrap()
                    + metrics.model_tool_overlap_ms.unwrap()
                    + metrics.waiting_ms.unwrap()
                    + metrics.residual_ms.unwrap()
            );
        }
    }

    #[test]
    fn normalized_tokens_include_cache_write_and_not_reasoning_twice() {
        let dashboard = aggregate(&session(vec![
            record("u", None, 10, RecordKind::User),
            record(
                "a",
                Some("u"),
                20,
                assistant(Some(12), usage(30, 7, 100, 5, Some(4)), vec![]),
            ),
        ]));
        let usage = dashboard.metrics.usage.unwrap();
        assert_eq!(usage.cached_prompt, 100);
        assert_eq!(usage.computed_prompt, 35);
        assert_eq!(usage.input, 135);
        assert_eq!(usage.output, 7);
        assert_eq!(usage.reasoning, Some(4));
        assert_eq!(usage.total, 142);
        assert_reconciles(&dashboard);
    }

    #[test]
    fn provider_total_is_only_a_diagnostic() {
        let mut reported = usage(3, 2, 5, 0, None);
        reported.provider_total = Some(999);
        let dashboard = aggregate(&session(vec![
            record("u", None, 1, RecordKind::User),
            record("a", Some("u"), 3, assistant(Some(2), reported, vec![])),
        ]));
        assert_eq!(dashboard.metrics.usage.unwrap().total, 10);
        assert_eq!(dashboard.diagnostics.provider_total_mismatch, 1);
    }

    #[test]
    fn reported_zero_differs_from_missing_usage() {
        let zero = aggregate(&session(vec![
            record("u", None, 1, RecordKind::User),
            record(
                "a",
                Some("u"),
                2,
                assistant(Some(1), usage(0, 0, 0, 0, Some(0)), vec![]),
            ),
        ]));
        assert_eq!(zero.metrics.usage.unwrap().total, 0);
        let missing = aggregate(&session(vec![
            record("u", None, 1, RecordKind::User),
            record(
                "a",
                Some("u"),
                2,
                assistant(Some(1), Usage::default(), vec![]),
            ),
        ]));
        assert_eq!(missing.metrics.usage, None);
        assert_eq!(missing.diagnostics.missing_usage, 1);
    }

    #[test]
    fn sequential_tool_calls_reconcile_cumulative_and_wall() {
        let dashboard = aggregate(&session(vec![
            record("u", None, 0, RecordKind::User),
            record(
                "a1",
                Some("u"),
                10,
                assistant(Some(1), usage(0, 0, 0, 0, None), vec![call("c1", "read")]),
            ),
            record("r1", Some("a1"), 30, result("c1", "read")),
            record(
                "a2",
                Some("r1"),
                40,
                assistant(Some(31), usage(0, 0, 0, 0, None), vec![call("c2", "grep")]),
            ),
            record("r2", Some("a2"), 70, result("c2", "grep")),
        ]));
        assert_eq!(dashboard.metrics.tool_cumulative_ms, Some(50));
        assert_eq!(dashboard.metrics.tool_wall_ms, Some(50));
        assert_eq!(dashboard.metrics.tool_overlap_ms, Some(0));
        assert_eq!(dashboard.metrics.tool_avg_ms, Some(25));
        let rendered_tool_events = dashboard
            .lanes
            .iter()
            .filter(|lane| lane.kind == LaneKind::Tool)
            .map(|lane| lane.events.len())
            .sum::<usize>();
        assert_eq!(rendered_tool_events, 2);
        assert!(
            dashboard
                .lanes
                .iter()
                .all(|lane| lane.kind != LaneKind::UnmatchedResult)
        );
        assert_reconciles(&dashboard);
    }

    #[test]
    fn overlapping_tool_calls_keep_cumulative_and_wall_distinct() {
        let dashboard = aggregate(&session(vec![
            record("u", None, 0, RecordKind::User),
            record(
                "a",
                Some("u"),
                10,
                assistant(
                    Some(1),
                    usage(0, 0, 0, 0, None),
                    vec![call("c1", "read"), call("c2", "grep")],
                ),
            ),
            record("r1", Some("a"), 40, result("c1", "read")),
            record("r2", Some("r1"), 60, result("c2", "grep")),
        ]));
        assert_eq!(dashboard.metrics.tool_cumulative_ms, Some(80));
        assert_eq!(dashboard.metrics.tool_wall_ms, Some(50));
        assert_eq!(dashboard.metrics.tool_overlap_ms, Some(30));
        let per_tool: i64 = dashboard
            .lanes
            .iter()
            .filter(|lane| lane.kind == LaneKind::Tool)
            .filter_map(|lane| lane.duration_ms)
            .sum();
        assert_eq!(per_tool, dashboard.metrics.tool_cumulative_ms.unwrap());
        assert_reconciles(&dashboard);
    }

    #[test]
    fn multiple_generations_have_complete_observed_timing_statistics() {
        let dashboard = aggregate(&session(vec![
            record("u", None, 0, RecordKind::User),
            record(
                "a1",
                Some("u"),
                20,
                assistant(Some(10), usage(0, 0, 0, 0, None), vec![]),
            ),
            record("u2", Some("a1"), 30, RecordKind::User),
            record(
                "a2",
                Some("u2"),
                70,
                assistant(Some(40), usage(0, 0, 0, 0, None), vec![]),
            ),
            record("u3", Some("a2"), 80, RecordKind::User),
            record(
                "a3",
                Some("u3"),
                130,
                assistant(Some(90), usage(0, 0, 0, 0, None), vec![]),
            ),
        ]));
        assert_eq!(dashboard.metrics.generation_count, 3);
        assert_eq!(dashboard.metrics.timed_generation_count, 3);
        assert_eq!(dashboard.metrics.model_cumulative_ms, Some(80));
        assert_eq!(dashboard.metrics.model_wall_ms, Some(80));
        assert_eq!(dashboard.metrics.model_avg_ms, Some(26));
        assert_eq!(dashboard.metrics.model_p95_ms, Some(40));
        assert_reconciles(&dashboard);
    }

    #[test]
    fn incomplete_generation_timing_hides_aggregate_durations() {
        let dashboard = aggregate(&session(vec![
            record("u", None, 1, RecordKind::User),
            record(
                "a1",
                Some("u"),
                5,
                assistant(Some(2), usage(0, 0, 0, 0, None), vec![]),
            ),
            record("u2", Some("a1"), 6, RecordKind::User),
            record(
                "a2",
                Some("u2"),
                9,
                assistant(None, usage(0, 0, 0, 0, None), vec![]),
            ),
        ]));
        assert_eq!(dashboard.metrics.timed_generation_count, 1);
        assert_eq!(dashboard.metrics.model_cumulative_ms, None);
        assert_eq!(dashboard.diagnostics.missing_timing, 1);
    }

    #[test]
    fn semantic_events_and_diagnostics_are_disjoint() {
        let mut model = session(vec![
            record("u", None, 1, RecordKind::User),
            record("old", Some("u"), 2, RecordKind::Other),
            record(
                "a",
                Some("u"),
                3,
                assistant(Some(2), usage(0, 0, 0, 0, None), vec![]),
            ),
            record("x", Some("a"), 4, RecordKind::Other),
            record("bad", Some("x"), 5, RecordKind::Invalid),
            record("r", Some("bad"), 6, result("missing", "read")),
        ]);
        model.malformed = 2;
        let dashboard = aggregate(&model);
        assert_eq!(dashboard.metrics.event_count, 3);
        assert_eq!(dashboard.metrics.unmatched_result_count, 1);
        assert_eq!(dashboard.diagnostics.abandoned_branch, 1);
        assert_eq!(dashboard.diagnostics.unknown_internal, 1);
        assert_eq!(dashboard.diagnostics.invalid, 1);
        assert_eq!(dashboard.diagnostics.malformed, 2);
        assert_eq!(dashboard.diagnostics.unmatched_results, 1);
        assert_reconciles(&dashboard);
    }

    #[test]
    fn duplicate_ids_do_not_collapse_calls_and_open_calls_are_provisional() {
        let dashboard = aggregate(&session(vec![
            record("u", None, 1, RecordKind::User),
            record(
                "a",
                Some("u"),
                2,
                assistant(
                    Some(1),
                    usage(0, 0, 0, 0, None),
                    vec![call("same", "read"), call("same", "read"), call("", "grep")],
                ),
            ),
            record("r", Some("a"), 5, result("same", "read")),
        ]));
        assert_eq!(dashboard.metrics.tool_call_count, 3);
        assert_eq!(dashboard.metrics.completed_tool_count, 1);
        assert_eq!(dashboard.metrics.open_tool_count, 2);
        assert_eq!(dashboard.diagnostics.duplicate_or_invalid_call_id, 2);
        assert!(dashboard.provisional);
        assert_reconciles(&dashboard);
    }

    #[test]
    fn wall_decomposition_is_exact_with_waiting_and_overlap() {
        let dashboard = aggregate(&session(vec![
            record("u1", None, 0, RecordKind::User),
            record(
                "a1",
                Some("u1"),
                20,
                assistant(Some(10), usage(0, 0, 0, 0, None), vec![]),
            ),
            record("u2", Some("a1"), 30, RecordKind::User),
            record(
                "a2",
                Some("u2"),
                50,
                assistant(Some(35), usage(0, 0, 0, 0, None), vec![call("c", "read")]),
            ),
            record("r", Some("a2"), 70, result("c", "read")),
            record(
                "a3",
                Some("r"),
                100,
                assistant(Some(60), usage(0, 0, 0, 0, None), vec![]),
            ),
        ]));
        assert_eq!(dashboard.metrics.wall_ms, Some(100));
        assert_eq!(dashboard.metrics.waiting_ms, Some(10));
        assert_eq!(dashboard.metrics.model_tool_overlap_ms, Some(10));
        assert_reconciles(&dashboard);
    }

    #[test]
    fn interval_union_property_holds_across_orderings() {
        let base = vec![(0, 10), (5, 20), (30, 40), (40, 45)];
        for intervals in [
            base.clone(),
            base.iter().rev().copied().collect(),
            vec![(30, 40), (0, 10), (40, 45), (5, 20)],
        ] {
            let cumulative: i64 = intervals.iter().map(|(start, end)| end - start).sum();
            let wall = union_duration(intervals);
            assert_eq!(wall, 35);
            assert!(wall <= cumulative);
        }
        assert_eq!(union_duration(Vec::new()), 0);
        assert_eq!(sum_durations(&[i64::MAX, 1]), i64::MAX);
    }

    #[test]
    fn sample_shape_reconciles_every_displayed_aggregate() {
        let mut records = vec![record("u", None, 0, RecordKind::User)];
        let calls = (0..3)
            .map(|i| call(&format!("f{i}"), "find"))
            .chain((0..4).map(|i| call(&format!("g{i}"), "grep")))
            .chain((0..16).map(|i| call(&format!("r{i}"), "read")))
            .collect::<Vec<_>>();
        records.push(record(
            "a0",
            Some("u"),
            1_000,
            assistant(
                Some(100),
                usage(38_000, 2_000, 151_000, 0, Some(500)),
                calls,
            ),
        ));
        let mut parent = "a0".to_owned();
        for (index, (id, name)) in (0..3)
            .map(|i| (format!("f{i}"), "find"))
            .chain((0..4).map(|i| (format!("g{i}"), "grep")))
            .chain((0..16).map(|i| (format!("r{i}"), "read")))
            .enumerate()
        {
            let record_id = format!("tr{index}");
            records.push(record(
                &record_id,
                Some(&parent),
                2_000 + index as i64 * 500,
                result(&id, name),
            ));
            parent = record_id;
        }
        for generation in 1..8 {
            let id = format!("a{generation}");
            let end = if generation == 7 {
                57_800
            } else {
                20_000 + generation as i64 * 4_000
            };
            records.push(record(
                &id,
                Some(&parent),
                end,
                assistant(Some(end - 1_000), usage(0, 0, 0, 0, Some(0)), vec![]),
            ));
            parent = id;
        }
        let dashboard = aggregate(&session(records));
        let metrics = &dashboard.metrics;
        assert_eq!(metrics.generation_count, 8);
        assert_eq!(metrics.tool_call_count, 23);
        assert_eq!(metrics.wall_ms, Some(57_800));
        let usage = metrics.usage.unwrap();
        assert_eq!(
            (
                usage.cached_prompt,
                usage.computed_prompt,
                usage.input,
                usage.output,
                usage.total
            ),
            (151_000, 38_000, 189_000, 2_000, 191_000)
        );
        for (name, count) in [("find", 3), ("grep", 4), ("read", 16)] {
            assert_eq!(
                dashboard
                    .lanes
                    .iter()
                    .find(|lane| lane.name == name)
                    .unwrap()
                    .count,
                count
            );
        }
        let per_tool_cumulative: i64 = dashboard
            .lanes
            .iter()
            .filter(|lane| lane.kind == LaneKind::Tool)
            .filter_map(|lane| lane.duration_ms)
            .sum();
        assert_eq!(Some(per_tool_cumulative), metrics.tool_cumulative_ms);
        assert_reconciles(&dashboard);
    }

    #[test]
    fn timeline_rows_keep_labels_events_and_summaries_visually_connected() {
        let activity = Activity {
            id: "event-1".into(),
            lane: "very-long-tool-name".into(),
            kind: LaneKind::Tool,
            start: 900,
            end: 900,
            label: "tool".into(),
            status: None,
            usage: Usage::default(),
            turn: 1,
            detail: String::new(),
        };
        let dashboard = Dashboard {
            start: Some(0),
            end: Some(1_000),
            activities: vec![activity],
            metrics: Metrics {
                wall_ms: Some(1_000),
                ..Metrics::default()
            },
            ..Dashboard::default()
        };
        let lane = Lane {
            name: "very-long-tool-name".into(),
            kind: LaneKind::Tool,
            events: vec![0],
            count: 1,
            duration_ms: None,
            duration_stat: None,
        };
        let geometry = TimelineGeometry::new(120);
        let line = render_lane(&lane, &dashboard, geometry, 1, false, false, None);
        let text = line
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();
        let chars = text.chars().collect::<Vec<_>>();
        assert_eq!(chars.len(), 120);
        assert!(text.contains("very-long-to…"));
        assert_eq!(chars[17], '│');
        assert_eq!(chars[18], '┊');
        assert_eq!(chars[98], '│');
        assert!(chars[19..98].contains(&'·'));
        assert_eq!(
            chars[18..98].iter().filter(|glyph| **glyph == '▏').count(),
            1
        );
        assert!(!text.contains('◆'));

        let axis = timeline_axis(geometry, dashboard.metrics.wall_ms)
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();
        let axis_chars = axis.chars().collect::<Vec<_>>();
        assert_eq!(axis_chars.len(), 120);
        assert_eq!(axis_chars[17], '│');
        assert_eq!(axis_chars[98], '│');
        assert!(axis.starts_with("            lane │"));
    }

    #[test]
    fn every_semantic_point_contributes_the_same_faint_activity_mark() {
        for kind in [
            LaneKind::User,
            LaneKind::Generation,
            LaneKind::Auxiliary,
            LaneKind::Tool,
            LaneKind::UnmatchedResult,
            LaneKind::Compaction,
        ] {
            let dashboard = Dashboard {
                start: Some(0),
                end: Some(1_000),
                activities: vec![Activity {
                    id: "event".into(),
                    lane: "lane".into(),
                    kind,
                    start: 500,
                    end: 500,
                    label: "event".into(),
                    status: None,
                    usage: Usage::default(),
                    turn: 1,
                    detail: String::new(),
                }],
                metrics: Metrics {
                    wall_ms: Some(1_000),
                    ..Metrics::default()
                },
                ..Dashboard::default()
            };
            let lane = Lane {
                name: "lane".into(),
                kind,
                events: vec![0],
                count: 1,
                duration_ms: None,
                duration_stat: None,
            };
            let geometry = TimelineGeometry::new(80);
            let line = render_lane(&lane, &dashboard, geometry, 1, false, false, None);
            let marks = line.spans[1..=geometry.plot_width]
                .iter()
                .filter(|span| span.content == "▏")
                .collect::<Vec<_>>();
            assert_eq!(marks.len(), 1, "wrong point density for {kind:?}");
            assert_eq!(marks[0].style.fg, Some(lane_color(kind)));
        }
    }

    #[test]
    fn raster_preserves_fractional_edges_gaps_continuity_and_point_density() {
        let event = |id: &str, start, end| Activity {
            id: id.into(),
            lane: "lane".into(),
            kind: LaneKind::Tool,
            start,
            end,
            label: "event".into(),
            status: None,
            usage: Usage::default(),
            turn: 1,
            detail: String::new(),
        };
        let dashboard = Dashboard {
            start: Some(0),
            end: Some(1_000),
            activities: vec![
                event("gap-a", 0, 40),
                event("gap-b", 50, 100),
                event("joined-a", 0, 40),
                event("joined-b", 40, 100),
                event("fractional", 125, 875),
                event("point-a", 500, 500),
                event("point-b", 500, 500),
                event("point-c", 500, 500),
                event("point-d", 500, 500),
                event("continuous", 0, 1_000),
            ],
            ..Dashboard::default()
        };
        let lane = |events| Lane {
            name: "lane".into(),
            kind: LaneKind::Tool,
            events,
            count: 0,
            duration_ms: None,
            duration_stat: None,
        };

        let gap = activity_density(&lane(vec![0, 1]), &dashboard, 10);
        assert!((gap[0] - 0.9).abs() < 1e-9);
        assert_eq!(activity_glyph(gap[0]), '▉');

        let joined = activity_density(&lane(vec![2, 3]), &dashboard, 10);
        assert!((joined[0] - 1.0).abs() < 1e-9);
        assert_eq!(activity_glyph(joined[0]), '█');

        let fractional = activity_density(&lane(vec![4]), &dashboard, 10);
        assert_eq!(activity_glyph(fractional[1]), '▊');
        assert!(
            fractional[2..8]
                .iter()
                .all(|load| activity_glyph(*load) == '█')
        );
        assert_eq!(activity_glyph(fractional[8]), '▊');
        assert_eq!(fractional[0], 0.0);
        assert_eq!(fractional[9], 0.0);

        let one_point = activity_density(&lane(vec![5]), &dashboard, 10);
        let four_points = activity_density(&lane(vec![5, 6, 7, 8]), &dashboard, 10);
        assert_eq!(activity_glyph(one_point[5]), '▏');
        assert_eq!(activity_glyph(four_points[5]), '▌');

        let continuous = activity_density(&lane(vec![9]), &dashboard, 10);
        assert!(continuous.iter().all(|load| activity_glyph(*load) == '█'));
    }

    #[test]
    fn activity_row_model_keeps_groups_and_children_in_one_sequence() {
        let lane = |name: &str, kind| Lane {
            name: name.into(),
            kind,
            events: Vec::new(),
            count: 0,
            duration_ms: None,
            duration_stat: None,
        };
        let lanes = vec![
            lane("Turns", LaneKind::Turns),
            lane("User messages", LaneKind::User),
            lane("Generations", LaneKind::Generation),
            lane("read", LaneKind::Tool),
            lane("bash", LaneKind::Tool),
            lane("Compactions", LaneKind::Compaction),
        ];
        assert_eq!(
            activity_rows(&lanes),
            vec![
                ActivityRow::Group { name: "RUN" },
                ActivityRow::Lane {
                    lane_index: 0,
                    depth: 1
                },
                ActivityRow::Lane {
                    lane_index: 1,
                    depth: 1
                },
                ActivityRow::Group { name: "MODEL" },
                ActivityRow::Lane {
                    lane_index: 2,
                    depth: 1
                },
                ActivityRow::Group { name: "TOOLS" },
                ActivityRow::Lane {
                    lane_index: 3,
                    depth: 1
                },
                ActivityRow::Lane {
                    lane_index: 4,
                    depth: 1
                },
                ActivityRow::Group { name: "SYSTEM" },
                ActivityRow::Lane {
                    lane_index: 5,
                    depth: 1
                },
            ]
        );
    }

    #[test]
    fn timeline_geometry_and_rows_are_exact_at_narrow_and_wide_widths() {
        let dashboard = Dashboard {
            start: Some(0),
            end: Some(1_000),
            metrics: Metrics {
                wall_ms: Some(1_000),
                ..Metrics::default()
            },
            ..Dashboard::default()
        };
        let lane = Lane {
            name: "a-tool-name-that-needs-truncation".into(),
            kind: LaneKind::Tool,
            events: Vec::new(),
            count: u64::MAX,
            duration_ms: Some(i64::MAX),
            duration_stat: Some(DurationStat::Cumulative),
        };
        for width in [80, 120, 200] {
            let geometry = TimelineGeometry::new(width);
            assert_eq!(geometry.width(), width as usize);
            let line = render_lane(&lane, &dashboard, geometry, 1, true, false, None);
            let text = line
                .spans
                .iter()
                .map(|span| span.content.as_ref())
                .collect::<String>();
            let chars = text.chars().collect::<Vec<_>>();
            assert_eq!(chars.len(), width as usize);
            assert_eq!(chars[LABEL_WIDTH - 1], '│');
            assert_eq!(chars[width as usize - SUMMARY_WIDTH], '│');
            assert!(line.spans.iter().all(|span| span.style.bg.is_some()));
        }
    }

    #[test]
    fn timeline_legend_explains_only_semantic_colors() {
        let colors = timeline_color_legend();
        let color_text = colors
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();
        for expected in [
            "green",
            "model",
            "orange",
            "tools",
            "purple",
            "compaction",
            "gray",
            "run/user",
        ] {
            assert!(color_text.contains(expected), "missing {expected:?}");
        }
        for forbidden in ["instant", "duration", "activity", "point", "selected"] {
            assert!(!color_text.contains(forbidden), "leaked {forbidden:?}");
        }
        assert!(!color_text.contains('◆'));
        assert!(color_text.chars().count() <= 72);
        assert_eq!(
            colors.spans[0].style.fg,
            Some(lane_color(LaneKind::Generation))
        );
        assert_eq!(colors.spans[2].style.fg, Some(lane_color(LaneKind::Tool)));
        assert_eq!(
            colors.spans[4].style.fg,
            Some(lane_color(LaneKind::Compaction))
        );
        assert_eq!(colors.spans[6].style.fg, Some(lane_color(LaneKind::User)));
        assert_eq!(lane_color(LaneKind::UnmatchedResult), ORANGE);
    }

    #[test]
    fn dense_and_short_events_keep_visible_boundaries_and_full_row_selection() {
        let activities = vec![
            Activity {
                id: "first".into(),
                lane: "read".into(),
                kind: LaneKind::Tool,
                start: 100,
                end: 800,
                label: "first".into(),
                status: None,
                usage: Usage::default(),
                turn: 1,
                detail: String::new(),
            },
            Activity {
                id: "point".into(),
                lane: "read".into(),
                kind: LaneKind::Tool,
                start: 100,
                end: 100,
                label: "point".into(),
                status: None,
                usage: Usage::default(),
                turn: 1,
                detail: String::new(),
            },
            Activity {
                id: "adjacent".into(),
                lane: "read".into(),
                kind: LaneKind::Tool,
                start: 500,
                end: 900,
                label: "adjacent".into(),
                status: None,
                usage: Usage::default(),
                turn: 1,
                detail: String::new(),
            },
        ];
        let dashboard = Dashboard {
            start: Some(0),
            end: Some(1_000),
            activities,
            metrics: Metrics {
                wall_ms: Some(1_000),
                ..Metrics::default()
            },
            ..Dashboard::default()
        };
        let lane = Lane {
            name: "read".into(),
            kind: LaneKind::Tool,
            events: vec![0, 1, 2],
            count: 3,
            duration_ms: Some(1_100),
            duration_stat: Some(DurationStat::Cumulative),
        };
        let line = render_lane(
            &lane,
            &dashboard,
            TimelineGeometry::new(80),
            1,
            false,
            true,
            Some(1),
        );
        let text = line
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();
        let plot = &line.spans[1..=TimelineGeometry::new(80).plot_width];
        assert!(plot.iter().any(|span| span.content == "█"));
        assert!(
            plot.iter()
                .filter(|span| "▏▎▍▌▋▊▉█".contains(span.content.as_ref()))
                .all(|span| span.style.fg == Some(ORANGE))
        );
        assert!(!text.contains('◆'));
        assert!(line.spans.iter().all(|span| span.style.bg.is_some()));
        assert!(text.starts_with("›   read"));
        assert!(text.ends_with("        1.1s"));
    }

    #[test]
    fn many_lanes_keep_the_selected_row_visible_at_supported_widths() {
        let lanes = (0..30)
            .map(|index| Lane {
                name: format!("tool-with-a-long-name-{index}"),
                kind: LaneKind::Tool,
                events: Vec::new(),
                count: index,
                duration_ms: None,
                duration_stat: None,
            })
            .collect();
        let dashboard = Dashboard {
            lanes,
            ..Dashboard::default()
        };
        let state = UiState {
            row: 29,
            ..UiState::default()
        };
        for width in [80, 200] {
            let backend = ratatui::backend::TestBackend::new(width, 34);
            let mut terminal = ratatui::Terminal::new(backend).unwrap();
            terminal
                .draw(|frame| render(frame, &dashboard, &state))
                .unwrap();
            let text = terminal
                .backend()
                .buffer()
                .content
                .iter()
                .map(|cell| cell.symbol())
                .collect::<String>();
            assert!(text.contains('›'));
            assert!(text.contains("tool-with-a"));
        }
    }

    #[test]
    fn overview_uses_plain_language_and_explains_the_timeline() {
        let dashboard = aggregate(&session(vec![
            record("u", None, 100, RecordKind::User),
            record(
                "a",
                Some("u"),
                300,
                assistant(Some(200), usage(10, 5, 2, 1, Some(1)), vec![]),
            ),
        ]));
        let backend = ratatui::backend::TestBackend::new(80, 34);
        let mut terminal = ratatui::Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| render(frame, &dashboard, &UiState::default()))
            .unwrap();
        let text = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        for expected in [
            "SESSION",
            "elapsed",
            "model calls",
            "tool calls",
            "WHERE TIME WENT",
            "idle / waiting",
            "unaccounted",
            "active time",
            "p95",
            "Timeline",
            "overlap",
            "green",
            "model",
            "orange",
            "tools",
            "purple",
            "compaction",
            "gray",
            "run/user",
            "RUN",
            "MODEL",
        ] {
            assert!(text.contains(expected), "missing {expected:?}");
        }
        for internal_term in [
            "instant",
            "point event",
            "duration",
            "activity",
            "selected row",
            "semantic events",
            "wall occupancy",
            "cumulative",
            "measure",
        ] {
            assert!(!text.contains(internal_term), "leaked {internal_term:?}");
        }
        assert!(!text.contains('◆'));
    }

    #[test]
    fn inspection_exposes_exact_accounting_ids_and_token_derivation() {
        let dashboard = aggregate(&session(vec![
            record("u", None, 100, RecordKind::User),
            record(
                "assistant-event",
                Some("u"),
                300,
                assistant(Some(200), usage(10, 5, 2, 1, Some(1)), vec![]),
            ),
        ]));
        let row = dashboard
            .lanes
            .iter()
            .position(|lane| lane.kind == LaneKind::Generation)
            .unwrap();
        let state = UiState {
            row,
            event: 0,
            inspect: true,
        };
        let backend = ratatui::backend::TestBackend::new(120, 40);
        let mut terminal = ratatui::Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| render(frame, &dashboard, &state))
            .unwrap();
        let text = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        for expected in [
            "assistant-event",
            "EXACT ACCOUNTING",
            "wall occupancy",
            "cumulative",
            "tool overlap",
            "wall split",
            "timed calls",
            "telemetry",
            "EVENT TOKENS (RAW → NORMALIZED)",
            "cache read",
            "cache write",
            "provider total",
            "normalized input = input + cache write + cache read",
        ] {
            assert!(text.contains(expected), "missing {expected:?}");
        }
    }

    #[test]
    fn incomplete_trailing_line_is_provisional_until_completed() {
        let root = std::env::temp_dir().join(format!("dev-agent-stats-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join("s.jsonl");
        let mut file = File::create(&path).unwrap();
        writeln!(file, "{{\"type\":\"session\",\"id\":\"s\",\"cwd\":\"/tmp\",\"timestamp\":\"1970-01-01T00:00:00Z\"}}").unwrap();
        write!(file, "{{\"type\":\"message\"").unwrap();
        file.flush().unwrap();
        let mut source = LiveSource::open(path.clone()).unwrap();
        assert!(source.model.incomplete_trailing);
        assert!(aggregate(&source.model).provisional);
        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, ",\"id\":\"u\",\"parentId\":null,\"timestamp\":\"1970-01-01T00:00:01Z\",\"message\":{{\"role\":\"user\"}}}}").unwrap();
        file.flush().unwrap();
        assert!(source.read_updates().unwrap());
        assert!(!source.model.incomplete_trailing);
        fs::remove_dir_all(root).unwrap();
    }
}
