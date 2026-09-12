use super::*;

fn overrides(args: &[String]) -> toml::Table {
    let mut out = toml::Table::new();
    for pair in args.chunks_exact(2) {
        assert_eq!(pair[0], "-c");
        // Read one key at a time so legitimate later overrides can replace earlier ones.
        let (key, value) = pair[1].split_once('=').unwrap();
        let parsed: toml::Table = toml::from_str(&format!("value={value}")).unwrap();
        out.insert(key.to_owned(), parsed["value"].clone());
    }
    out
}

#[test]
fn every_profile_uses_the_same_model_as_its_named_subagent() {
    let config = load_agent_config().unwrap();
    for profile in [AgentProfileName::Default, AgentProfileName::Spec, AgentProfileName::Plan,
        AgentProfileName::Build, AgentProfileName::Review, AgentProfileName::Project, AgentProfileName::Explore] {
        let selected = agent_profile(&config, profile).unwrap();
        let role = agent_roles::load(&selected.role).unwrap();
        let args = overrides(&agent_codex_args(&config, profile).unwrap());
        assert_eq!(args["model"].as_str(), Some(role.model.as_str()));
        assert_eq!(args["model_reasoning_effort"].as_str(), Some(role.model_reasoning_effort.as_str()));
        assert!(!args.contains_key("developer_instructions"));
    }
}

#[test]
fn duplicate_profile_model_selection_is_rejected() {
    let duplicate = r#"
        [profiles.build]
        role = "builder"
        model = "second-source"
    "#;
    assert!(toml::from_str::<AgentConfig>(duplicate).is_err());
    assert!(parse_agent_config("[codex]\nmodel=\"duplicate\"").is_err());
    assert!(parse_agent_config("[codex.agents]\ndefault_subagent_model=\"duplicate\"").is_err());
    let config = load_agent_config().unwrap();
    assert!(!config.codex.contains_key("model"));
    assert!(!config.codex.contains_key("model_reasoning_effort"));
}

#[test]
fn no_task_session_is_not_an_orchestrator_assignment() {
    let config = load_agent_config().unwrap();
    assert!(agent_prompt(&config, AgentProfileName::Default, &[], Path::new("/cache")).unwrap().is_none());
}

#[test]
fn role_is_activated_even_when_no_task_prompt_is_given() {
    let config = load_agent_config().unwrap();
    for profile in [AgentProfileName::Spec, AgentProfileName::Plan, AgentProfileName::Build,
        AgentProfileName::Review, AgentProfileName::Project, AgentProfileName::Explore] {
        let selected = agent_profile(&config, profile).unwrap();
        let asset = agent_roles::asset(&selected.role).unwrap();
        let prompt = agent_prompt(&config, profile, &[], Path::new("/cache with spaces")).unwrap().unwrap();
        assert!(prompt.starts_with(&format!("${}\n", asset.skill_name)));
        assert!(prompt.contains("No assignment supplied yet"));
        assert!(prompt.contains("/cache with spaces"));
    }
}

#[test]
fn leaf_explorer_and_reviewer_use_read_only_defaults() {
    let config = load_agent_config().unwrap();
    let explorer = overrides(&agent_codex_args(&config, AgentProfileName::Explore).unwrap());
    assert_eq!(explorer["sandbox_mode"].as_str(), Some("read-only"));
    assert_eq!(explorer["agents.enabled"].as_bool(), Some(false));
    let reviewer = overrides(&agent_codex_args(&config, AgentProfileName::Review).unwrap());
    assert_eq!(reviewer["sandbox_mode"].as_str(), Some("read-only"));
}

#[test]
fn resume_never_injects_a_new_model_role_or_sandbox() {
    assert_eq!(resume_args(None, false).unwrap(), vec!["resume"]);
    assert_eq!(resume_args(None, true).unwrap(), vec!["resume", "--last"]);
    assert_eq!(resume_args(Some("session-id"), false).unwrap(), vec!["resume", "--", "session-id"]);
    assert!(resume_args(Some("id"), true).is_err());
    assert!(resume_args(Some(""), false).is_err());
}

#[test]
fn command_aliases_remain_available() {
    for (alias, expected) in [("s", "spec"), ("specifier", "spec"), ("p", "plan"),
        ("b", "build"), ("r", "review"), ("e", "explore"), ("pr", "project"), ("orchestrate", "project")] {
        let parsed = Cli::try_parse_from(["dev", "a", alias, "task"]).unwrap();
        let actual = match parsed.command {
            Commands::Agent { action: Some(AgentAction::Spec { .. }) } => "spec",
            Commands::Agent { action: Some(AgentAction::Plan { .. }) } => "plan",
            Commands::Agent { action: Some(AgentAction::Build { .. }) } => "build",
            Commands::Agent { action: Some(AgentAction::Review { .. }) } => "review",
            Commands::Agent { action: Some(AgentAction::Explore { .. }) } => "explore",
            Commands::Agent { action: Some(AgentAction::Project { .. }) } => "project",
            _ => panic!("Unexpected action for {alias}"),
        };
        assert_eq!(actual, expected);
    }
    assert!(Cli::try_parse_from(["dev", "a", "resume", "id", "--last"]).is_err());
    for cmd in ["stats", "transcript", "config"] {
        assert!(Cli::try_parse_from(["dev", "a", cmd]).is_ok());
    }
}

#[test]
fn runtime_registration_contains_paths_not_duplicate_model_selection() {
    let args = overrides(&agent_roles::registration_args(Path::new("/cache with spaces")).unwrap());
    for a in agent_roles::ALL {
        assert!(args.get(&format!("agents.{}.config_file", a.name)).unwrap().as_str().unwrap().contains("/cache with spaces"));
    }
    assert!(args.keys().all(|k| k.ends_with(".config_file") || k.ends_with(".description")));
}

#[test]
fn toml_string_encoding_round_trips_special_characters() {
    for text in ["simple", "path with spaces", "a\"b\\c\n", "tab\tand\u{1b}", "Unicode 日本語"] {
        let value = toml_scalar(&toml::Value::String(text.into())).unwrap();
        let decoded: toml::Table = toml::from_str(&format!("value={value}")).unwrap();
        assert_eq!(decoded["value"].as_str(), Some(text));
    }
}
