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
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
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
    total: Option<u64>,
}

impl Usage {
    /// Pi/provider `totalTokens` is authoritative. When absent, total is the
    /// non-overlapping provider categories input + output + cache read/write.
    /// Reasoning is not added because Pi defines it as a subset of output.
    fn accounted_total(self) -> Option<u64> {
        self.total.or_else(|| {
            [self.input, self.output, self.cache_read, self.cache_write]
                .into_iter()
                .flatten()
                .reduce(u64::saturating_add)
        })
    }

    fn add(&mut self, other: Self) {
        add_optional(&mut self.input, other.input);
        add_optional(&mut self.output, other.output);
        add_optional(&mut self.cache_read, other.cache_read);
        add_optional(&mut self.cache_write, other.cache_write);
        add_optional(&mut self.reasoning, other.reasoning);
        add_optional(&mut self.total, other.accounted_total());
    }
}

fn add_optional(target: &mut Option<u64>, value: Option<u64>) {
    if let Some(value) = value {
        *target = Some(target.unwrap_or(0).saturating_add(value));
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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LaneKind {
    All,
    Laps,
    Generation,
    Tool,
    Compaction,
}

#[derive(Clone, Debug)]
struct Activity {
    lane: String,
    kind: LaneKind,
    start: i64,
    end: i64,
    label: String,
    status: Option<String>,
    usage: Usage,
    lap: usize,
    detail: String,
}

#[derive(Clone, Debug)]
struct Lane {
    name: String,
    kind: LaneKind,
    events: Vec<usize>,
    count: Option<u64>,
    duration_ms: Option<i64>,
}

/// Audited session metrics. Time values are elapsed wall-time milliseconds.
/// `wall_ms` is header-to-last-active-branch-entry. `tool_ms` is union
/// occupancy of completed tool intervals, so overlapping tools count once.
/// Laps partition wall time at user-message boundaries; therefore their count
/// and average use the same population and `avg_lap_ms = wall_ms / laps`.
/// Provider phase timings and rates remain None unless Pi persists both their
/// numerator and interval; ordinary Pi JSONL currently does not.
#[derive(Debug, Default)]
struct Metrics {
    usage: Usage,
    // Tokenized tool-result prompt contribution is not persisted by Pi.
    tool_result_tokens: Option<u64>,
    wall_ms: Option<i64>,
    tool_ms: Option<i64>,
    laps: usize,
    avg_lap_ms: Option<i64>,
    activity_count: usize,
    context_percent: Option<f64>,
    tg_per_sec: Option<f64>,
    pp_per_sec: Option<f64>,
    prefill_ms: Option<i64>,
    generation_ms: Option<i64>,
    startup_ms: Option<i64>,
    first_token_ms: Option<i64>,
    reasoning_ms: Option<i64>,
    compaction_ms: Option<i64>,
}

#[derive(Debug, Default)]
struct Dashboard {
    session_id: String,
    start: Option<i64>,
    end: Option<i64>,
    metrics: Metrics,
    activities: Vec<Activity>,
    lanes: Vec<Lane>,
    lap_starts: Vec<i64>,
    malformed: u64,
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
        return RecordKind::Other;
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
        _ => RecordKind::Other,
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
    let mut usage = Usage {
        input: uint(value, "input"),
        output: uint(value, "output"),
        cache_read: uint(value, "cacheRead"),
        cache_write: uint(value, "cacheWrite"),
        reasoning: uint(value, "reasoning"),
        total: uint(value, "totalTokens"),
    };
    usage.total = usage.accounted_total();
    usage
}
fn uint(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn active_branch(model: &SessionModel) -> Vec<&Record> {
    // Pi's active leaf is the last persisted identifiable entry. Unknown future
    // metadata without an id must not make us aggregate abandoned branches.
    let Some(last) = model
        .records
        .iter()
        .rev()
        .find(|record| !record.id.is_empty())
    else {
        return model.records.iter().collect();
    };
    let by_id: HashMap<&str, &Record> = model
        .records
        .iter()
        .filter(|record| !record.id.is_empty())
        .map(|record| (record.id.as_str(), record))
        .collect();
    let mut branch = Vec::new();
    let mut next = Some(last.id.as_str());
    let mut seen = HashSet::new();
    while let Some(id) = next {
        if !seen.insert(id) {
            break;
        }
        let Some(record) = by_id.get(id).copied() else {
            break;
        };
        branch.push(record);
        next = record.parent.as_deref();
    }
    branch.reverse();
    branch
}

fn aggregate(model: &SessionModel) -> Dashboard {
    let branch = active_branch(model);
    let mut dashboard = Dashboard {
        session_id: model.id.clone(),
        start: model.started_at,
        malformed: model.malformed,
        ..Dashboard::default()
    };
    let mut calls: HashMap<String, (ToolCall, i64, usize)> = HashMap::new();
    let mut tool_lanes: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut lap = 0usize;

    for record in branch {
        if let Some(at) = record.at {
            dashboard.end = Some(dashboard.end.map_or(at, |old| old.max(at)));
        }
        match &record.kind {
            RecordKind::User => {
                lap += 1;
                if let Some(at) = record.at {
                    dashboard.lap_starts.push(at);
                }
                add_point(
                    &mut dashboard,
                    "All activity",
                    LaneKind::All,
                    record.at,
                    "user",
                    None,
                    Usage::default(),
                    lap,
                    "user message",
                );
            }
            RecordKind::Assistant {
                model,
                usage,
                calls: tool_calls,
            } => {
                dashboard.metrics.usage.add(*usage);
                add_point(
                    &mut dashboard,
                    "generation",
                    LaneKind::Generation,
                    record.at,
                    "assistant",
                    None,
                    *usage,
                    lap,
                    &format!(
                        "assistant response · {}",
                        model.as_deref().unwrap_or("unknown model")
                    ),
                );
                for call in tool_calls {
                    if let Some(at) = record.at {
                        calls.insert(call.id.clone(), (call.clone(), at, lap));
                    }
                }
            }
            RecordKind::ToolResult {
                call_id,
                name,
                failed,
                usage,
            } => {
                dashboard.metrics.usage.add(*usage);
                // Tool-result message usage is auxiliary LLM usage, not the
                // tokenized size of tool output in a later prompt. Pi does not
                // persist the latter, so prompt/tool-result tokens stay None.
                let end = record.at;
                if let (Some((call, start, call_lap)), Some(end)) = (calls.remove(call_id), end) {
                    let lane = call.name.clone();
                    let index = dashboard.activities.len();
                    dashboard.activities.push(Activity {
                        lane: lane.clone(),
                        kind: LaneKind::Tool,
                        start,
                        end: end.max(start),
                        label: call.name.clone(),
                        status: Some(
                            if failed.unwrap_or(false) {
                                "failed"
                            } else {
                                "ok"
                            }
                            .into(),
                        ),
                        usage: *usage,
                        lap: call_lap,
                        detail: call.summary,
                    });
                    tool_lanes.entry(lane).or_default().push(index);
                } else {
                    add_point(
                        &mut dashboard,
                        name.as_deref().unwrap_or("tool"),
                        LaneKind::Tool,
                        end,
                        name.as_deref().unwrap_or("tool result"),
                        failed.map(|failed| if failed { "failed" } else { "ok" }.into()),
                        *usage,
                        lap,
                        "unmatched tool result",
                    );
                }
            }
            RecordKind::Compaction { usage } => {
                dashboard.metrics.usage.add(*usage);
                add_point(
                    &mut dashboard,
                    "compaction",
                    LaneKind::Compaction,
                    record.at,
                    "compaction",
                    None,
                    *usage,
                    lap,
                    "context compaction",
                );
            }
            RecordKind::Usage(usage) => dashboard.metrics.usage.add(*usage),
            RecordKind::Other => {}
        }
    }
    // Open tool calls are points at their actual start, explicitly marked running.
    for (_, (call, start, call_lap)) in calls {
        let index = dashboard.activities.len();
        dashboard.activities.push(Activity {
            lane: call.name.clone(),
            kind: LaneKind::Tool,
            start,
            end: start,
            label: call.name.clone(),
            status: Some("running".into()),
            usage: Usage::default(),
            lap: call_lap,
            detail: call.summary,
        });
        tool_lanes.entry(call.name).or_default().push(index);
    }
    dashboard.start = dashboard
        .start
        .or_else(|| dashboard.lap_starts.first().copied());
    if let (Some(start), Some(end)) = (dashboard.start, dashboard.end) {
        debug_assert!(end >= start, "session end must not precede session start");
        dashboard.metrics.wall_ms = Some(end.saturating_sub(start).max(0));
    }
    dashboard.metrics.laps = lap;
    // Laps are elapsed wall-clock regions partitioned by user-message
    // boundaries. The first region starts at the session header and the last
    // ends at the observed session end, so their durations sum to wall clock.
    if lap > 0 {
        if let Some(start) = dashboard.start
            && let Some(first) = dashboard.lap_starts.first_mut()
        {
            *first = start;
        }
        dashboard.metrics.avg_lap_ms = dashboard.metrics.wall_ms.map(|wall| wall / lap as i64);
    }
    let tool_ms = union_duration(
        dashboard
            .activities
            .iter()
            .filter(|event| event.kind == LaneKind::Tool && event.end > event.start)
            .map(|event| (event.start, event.end))
            .collect(),
    );
    if dashboard
        .activities
        .iter()
        .any(|event| event.kind == LaneKind::Tool && event.end > event.start)
    {
        debug_assert!(dashboard.metrics.wall_ms.is_none_or(|wall| tool_ms <= wall));
        dashboard.metrics.tool_ms = Some(tool_ms);
    }
    dashboard.metrics.activity_count = dashboard.activities.len();

    dashboard.lanes.push(Lane {
        name: "All activity".into(),
        kind: LaneKind::All,
        events: (0..dashboard.activities.len()).collect(),
        count: Some(dashboard.metrics.activity_count as u64),
        duration_ms: dashboard.metrics.wall_ms,
    });
    dashboard.lanes.push(Lane {
        name: "laps".into(),
        kind: LaneKind::Laps,
        events: Vec::new(),
        count: Some(lap as u64),
        duration_ms: dashboard.metrics.wall_ms,
    });
    let generation = dashboard
        .activities
        .iter()
        .enumerate()
        .filter(|(_, event)| event.kind == LaneKind::Generation)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if !generation.is_empty() {
        dashboard.lanes.push(Lane {
            name: "generation".into(),
            kind: LaneKind::Generation,
            count: Some(generation.len() as u64),
            events: generation,
            // Pi persists response completion timestamps, not generation start.
            duration_ms: None,
        });
    }
    for (name, events) in tool_lanes {
        let duration = union_duration(
            events
                .iter()
                .map(|index| {
                    let event = &dashboard.activities[*index];
                    (event.start, event.end)
                })
                .collect(),
        );
        dashboard.lanes.push(Lane {
            name,
            kind: LaneKind::Tool,
            count: Some(events.len() as u64),
            duration_ms: Some(duration),
            events,
        });
    }
    let compactions = dashboard
        .activities
        .iter()
        .enumerate()
        .filter(|(_, event)| event.kind == LaneKind::Compaction)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if !compactions.is_empty() {
        dashboard.lanes.push(Lane {
            name: "compaction".into(),
            kind: LaneKind::Compaction,
            count: Some(compactions.len() as u64),
            duration_ms: None,
            events: compactions,
        });
    }
    dashboard
}

fn union_duration(mut intervals: Vec<(i64, i64)>) -> i64 {
    intervals.sort_by_key(|interval| interval.0);
    let mut total = 0_i64;
    let mut current: Option<(i64, i64)> = None;
    for (start, end) in intervals {
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

#[allow(clippy::too_many_arguments)]
fn add_point(
    dashboard: &mut Dashboard,
    lane: &str,
    kind: LaneKind,
    at: Option<i64>,
    label: &str,
    status: Option<String>,
    usage: Usage,
    lap: usize,
    detail: &str,
) {
    if let Some(at) = at {
        dashboard.activities.push(Activity {
            lane: lane.into(),
            kind,
            start: at,
            end: at,
            label: label.into(),
            status,
            usage,
            lap,
            detail: detail.into(),
        });
    }
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
    let mut state = UiState::default();
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
const SUMMARY_WIDTH: usize = 18;
const MAX_BUCKETS: usize = 140;

fn render(frame: &mut ratatui::Frame<'_>, dashboard: &Dashboard, state: &UiState) {
    let viewport = frame.area();
    if viewport.width < 80 || viewport.height < 28 {
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
            Constraint::Length(4),
            Constraint::Length(13),
            Constraint::Length(1),
            Constraint::Min(9),
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
    let diagnostics = if dashboard.malformed > 0 {
        format!("  · {} skipped", dashboard.malformed)
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
        render_inspector(frame, area, activity);
    }
}

fn render_header(frame: &mut ratatui::Frame<'_>, area: Rect, dashboard: &Dashboard) {
    let pct = dashboard
        .metrics
        .context_percent
        .map(|value| format!("◔ {:.0}%", value))
        .unwrap_or_else(|| "◔ —".into());
    let gap = area.width.saturating_sub(8 + pct.len() as u16) as usize;
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
                Span::styled(pct, Style::default().fg(BLUE)),
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
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(46),
            Constraint::Percentage(8),
            Constraint::Percentage(46),
        ])
        .split(inner);
    let m = &dashboard.metrics;
    let lw = cols[0].width as usize;
    let rw = cols[2].width as usize;
    let left = vec![
        stat("tg/s", opt_rate(m.tg_per_sec), Color::White, lw),
        stat("laps", m.laps.to_string(), Color::White, lw),
        Line::raw(""),
        heading("TIME"),
        stat("  wall clock", opt_duration(m.wall_ms), Color::White, lw),
        stat("● prefill", opt_duration(m.prefill_ms), BLUE, lw),
        stat("● generation", opt_duration(m.generation_ms), GREEN, lw),
        stat("● tools", opt_duration(m.tool_ms), ORANGE, lw),
        Line::raw(""),
        heading("TOKENS"),
        stat("  total", opt_tokens(m.usage.total), Color::White, lw),
        stat("● prompt, computed", opt_tokens(m.usage.input), BLUE, lw),
        stat("● completion", opt_tokens(m.usage.output), GREEN, lw),
    ];
    let right = vec![
        stat("pp/s", opt_rate(m.pp_per_sec), Color::White, rw),
        stat("avg/lap", opt_duration(m.avg_lap_ms), Color::White, rw),
        Line::raw(""),
        Line::raw(""),
        stat("  startup", opt_duration(m.startup_ms), Color::White, rw),
        stat("● first token", opt_duration(m.first_token_ms), BLUE, rw),
        stat("● reasoning", opt_duration(m.reasoning_ms), MINT, rw),
        stat("● compaction", opt_duration(m.compaction_ms), PURPLE, rw),
        Line::raw(""),
        Line::raw(""),
        stat(
            "● prompt, cached",
            opt_tokens(m.usage.cache_read),
            Color::LightBlue,
            rw,
        ),
        stat(
            "● prompt, tool results",
            opt_tokens(m.tool_result_tokens),
            ORANGE,
            rw,
        ),
        stat("● reasoning", opt_tokens(m.usage.reasoning), MINT, rw),
    ];
    frame.render_widget(Paragraph::new(left), cols[0]);
    frame.render_widget(Paragraph::new(right), cols[2]);
}
fn heading(text: &'static str) -> Line<'static> {
    Line::from(Span::styled(
        text,
        Style::default()
            .fg(Color::White)
            .add_modifier(Modifier::BOLD),
    ))
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
    let lane_capacity = area.height.saturating_sub(6) as usize;
    let scroll = state.row.saturating_sub(lane_capacity.saturating_sub(3));
    let count = dashboard.metrics.activity_count.to_string();
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                "⌄  Activity",
                Style::default().fg(MUTED).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" ".repeat(area.width.saturating_sub(12 + count.len() as u16) as usize)),
            Span::styled(count, Style::default().fg(MUTED)),
        ]),
        Line::from(vec![
            Span::styled("activity    ", Style::default().fg(MUTED)),
            Span::styled(
                format!(
                    "{} → {} · {} · {} events",
                    clock(dashboard.start),
                    clock(dashboard.end),
                    opt_duration(dashboard.metrics.wall_ms),
                    dashboard.metrics.activity_count
                ),
                Style::default().fg(MUTED),
            ),
        ]),
        timeline_axis(area.width, dashboard.metrics.wall_ms),
        timeline_guides(area.width, dashboard.metrics.wall_ms),
    ];
    let mut previous_kind = None;
    for (index, lane) in dashboard.lanes.iter().enumerate().skip(scroll) {
        let group = match lane.kind {
            LaneKind::Generation if !previous_kind.is_some_and(is_assistant_lane) => {
                Some("ASSISTANT")
            }
            LaneKind::Tool if previous_kind != Some(LaneKind::Tool) => Some("TOOLS"),
            _ => None,
        };
        if let Some(group) = group {
            if lines.len() + 3 >= area.height as usize {
                break;
            }
            lines.push(Line::raw(""));
            lines.push(group_line(group, area.width));
        }
        if lines.len() + 1 >= area.height as usize {
            break;
        }
        lines.push(render_lane(
            lane,
            dashboard,
            area.width,
            index == state.row,
            (index == state.row).then_some(state.event),
        ));
        previous_kind = Some(lane.kind);
    }
    frame.render_widget(Paragraph::new(lines), area);
}

fn timeline_guides(width: u16, wall_ms: Option<i64>) -> Line<'static> {
    let raster_width = graph_width(width);
    let mut cells = vec![' '; raster_width];
    for (position, _) in time_ticks(raster_width, wall_ms) {
        cells[position] = '│';
    }
    Line::from(vec![
        Span::raw(" ".repeat(LABEL_WIDTH)),
        Span::styled(
            cells.into_iter().collect::<String>(),
            Style::default().fg(GRID),
        ),
    ])
}

fn group_line(name: &'static str, width: u16) -> Line<'static> {
    let graph_width = graph_width(width);
    Line::from(vec![
        Span::styled(
            format!("  {name:<16}"),
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled("─".repeat(graph_width), Style::default().fg(TRACK)),
    ])
}

fn graph_width(width: u16) -> usize {
    (width as usize)
        .saturating_sub(LABEL_WIDTH + SUMMARY_WIDTH)
        .clamp(1, MAX_BUCKETS)
}

fn is_assistant_lane(kind: LaneKind) -> bool {
    kind == LaneKind::Generation
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

fn timeline_axis(width: u16, wall_ms: Option<i64>) -> Line<'static> {
    let graph_width = graph_width(width);
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
        Span::raw(" ".repeat(LABEL_WIDTH)),
        Span::styled(
            cells.into_iter().collect::<String>(),
            Style::default().fg(GRID).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  {:>5} {:>9}", "count", "time"),
            Style::default().fg(MUTED).add_modifier(Modifier::BOLD),
        ),
    ])
}

fn render_lane(
    lane: &Lane,
    dashboard: &Dashboard,
    width: u16,
    selected: bool,
    selected_event: Option<usize>,
) -> Line<'static> {
    let bucket_count = graph_width(width);
    let mut cells = vec![' '; bucket_count];
    let mut colors = vec![lane_color(lane.kind); bucket_count];
    let mut highlights = vec![false; bucket_count];

    if lane.kind == LaneKind::Laps {
        cells.fill('─');
        colors.fill(MUTED);
        for (number, at) in dashboard.lap_starts.iter().enumerate() {
            let start = scale_point(*at, dashboard.start, dashboard.end, bucket_count);
            let end = dashboard
                .lap_starts
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
        let scores = bucket_scores(lane, dashboard, bucket_count);
        for (index, score) in scores.into_iter().enumerate() {
            cells[index] = intensity_glyph(score);
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
            if cells[start] == ' ' {
                cells[start] = '░';
            }
        }
    }

    let label = truncate_left(&lane.name, LABEL_WIDTH - 4);
    let mut spans = vec![Span::styled(
        format!("{} {:>14}  ", if selected { "›" } else { " " }, label),
        Style::default()
            .fg(if selected { Color::White } else { MUTED })
            .add_modifier(if selected {
                Modifier::BOLD
            } else {
                Modifier::empty()
            }),
    )];
    for index in 0..bucket_count {
        let mut style = Style::default().fg(colors[index]);
        if highlights[index] {
            style = style
                .fg(Color::White)
                .bg(Color::Rgb(51, 65, 85))
                .add_modifier(Modifier::BOLD);
        }
        spans.push(Span::styled(cells[index].to_string(), style));
    }
    let count = lane
        .count
        .map(|value| value.to_string())
        .unwrap_or_else(|| "—".into());
    let duration = lane
        .duration_ms
        .map(format_duration)
        .unwrap_or_else(|| "—".into());
    spans.push(Span::styled(
        format!("  {:>5} {:>9}", count, duration),
        Style::default()
            .fg(if selected { Color::White } else { MUTED })
            .add_modifier(if selected {
                Modifier::BOLD
            } else {
                Modifier::empty()
            }),
    ));
    Line::from(spans)
}

fn bucket_scores(lane: &Lane, dashboard: &Dashboard, bucket_count: usize) -> Vec<f64> {
    let mut scores = vec![0.0_f64; bucket_count];
    let (Some(session_start), Some(session_end)) = (dashboard.start, dashboard.end) else {
        return scores;
    };
    let duration = session_end.saturating_sub(session_start).max(1) as f64;
    let bucket_ms = duration / bucket_count as f64;
    for index in &lane.events {
        let event = &dashboard.activities[*index];
        if event.end > event.start {
            let first = (((event.start - session_start).max(0) as f64 / duration)
                * bucket_count as f64)
                .floor() as usize;
            let last = (((event.end - session_start).max(0) as f64 / duration)
                * bucket_count as f64)
                .floor() as usize;
            for (bucket, score) in scores
                .iter_mut()
                .enumerate()
                .take(last.min(bucket_count - 1) + 1)
                .skip(first.min(bucket_count - 1))
            {
                let bucket_start = session_start as f64 + bucket as f64 * bucket_ms;
                let bucket_end = bucket_start + bucket_ms;
                let overlap =
                    (event.end as f64).min(bucket_end) - (event.start as f64).max(bucket_start);
                if overlap > 0.0 {
                    *score += overlap / bucket_ms + 0.15;
                }
            }
        } else {
            let bucket = scale_point(event.start, dashboard.start, dashboard.end, bucket_count);
            scores[bucket] += 0.55;
            if bucket > 0 {
                scores[bucket - 1] += 0.12;
            }
            if bucket + 1 < bucket_count {
                scores[bucket + 1] += 0.12;
            }
        }
    }
    scores
}

fn intensity_glyph(score: f64) -> char {
    if score <= 0.0 {
        ' '
    } else if score < 0.25 {
        '░'
    } else if score < 0.65 {
        '▒'
    } else if score < 1.1 {
        '▓'
    } else {
        '█'
    }
}

fn lane_color(kind: LaneKind) -> Color {
    match kind {
        LaneKind::Generation | LaneKind::All => GREEN,
        LaneKind::Tool => ORANGE,
        LaneKind::Compaction => PURPLE,
        LaneKind::Laps => MUTED,
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
    let x1 = scale_point(start_at, start, end, width);
    let x2 = scale_point(end_at.max(start_at), start, end, width);
    (x1, x2.max(x1))
}

fn render_inspector(frame: &mut ratatui::Frame<'_>, area: Rect, event: &Activity) {
    let width = area.width.min(72);
    let height = area.height.min(15);
    let popup = Rect::new(
        area.x + (area.width - width) / 2,
        area.y + (area.height - height) / 2,
        width,
        height,
    );
    frame.render_widget(Clear, popup);
    let lines = vec![
        Line::from(vec![
            Span::styled("type       ", Style::default().fg(MUTED)),
            Span::raw(event.label.clone()),
        ]),
        Line::from(vec![
            Span::styled("lane       ", Style::default().fg(MUTED)),
            Span::raw(event.lane.clone()),
        ]),
        Line::from(vec![
            Span::styled("start      ", Style::default().fg(MUTED)),
            Span::raw(timestamp_text(event.start)),
        ]),
        Line::from(vec![
            Span::styled("end        ", Style::default().fg(MUTED)),
            Span::raw(timestamp_text(event.end)),
        ]),
        Line::from(vec![
            Span::styled("duration   ", Style::default().fg(MUTED)),
            Span::raw(if event.end > event.start {
                opt_duration(Some(event.end - event.start))
            } else {
                "instant".into()
            }),
        ]),
        Line::from(vec![
            Span::styled("status     ", Style::default().fg(MUTED)),
            Span::raw(event.status.clone().unwrap_or_else(|| "—".into())),
        ]),
        Line::from(vec![
            Span::styled("lap        ", Style::default().fg(MUTED)),
            Span::raw(event.lap.to_string()),
        ]),
        Line::from(vec![
            Span::styled("tokens     ", Style::default().fg(MUTED)),
            Span::raw(opt_tokens(event.usage.total)),
        ]),
        Line::raw(""),
        Line::from(event.detail.clone()),
        Line::raw(""),
        Line::styled("Esc close", Style::default().fg(MUTED)),
    ];
    frame.render_widget(
        Paragraph::new(lines).wrap(Wrap { trim: true }).block(
            Block::default()
                .title(" Event ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(MUTED)),
        ),
        popup,
    );
}

fn short_id(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

fn opt_tokens(value: Option<u64>) -> String {
    value.map(compact).unwrap_or_else(|| "—".into())
}
fn opt_rate(value: Option<f64>) -> String {
    value
        .filter(|v| v.is_finite())
        .map(|v| format!("{v:.1}"))
        .unwrap_or_else(|| "—".into())
}
fn opt_duration(value: Option<i64>) -> String {
    value.map(format_duration).unwrap_or_else(|| "—".into())
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
fn truncate_left(value: &str, width: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= width {
        value.to_owned()
    } else {
        chars[chars.len() - width..].iter().collect()
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
