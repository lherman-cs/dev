fn first_scalar_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Array(items) => items.first().and_then(first_scalar_i64),
        Value::Object(map) => map.values().next().and_then(|v| v.as_i64().or_else(|| v.as_str()?.parse().ok())),
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn value_i64(value: &Value, key: &str) -> Result<i64> {
    value.get(key).and_then(|v| v.as_i64().or_else(|| v.as_str()?.parse().ok()))
        .ok_or_else(|| anyhow!("field {key} is not integer"))
}

fn value_str<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value.get(key).and_then(Value::as_str).ok_or_else(|| anyhow!("field {key} is not string"))
}

fn value_opt_str(value: &Value, key: &str) -> Result<Option<String>> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        _ => bail!("field {key} is not nullable string"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_parser_handles_quotes_without_shell() {
        assert_eq!(split_command("cargo test -p 'pulse beam' -- --exact \"a b\"").unwrap(),
            vec!["cargo","test","-p","pulse beam","--","--exact","a b"]);
        assert!(split_command("bash -lc 'cargo test'").is_err());
        assert!(split_command("cargo test 'oops").is_err());
    }

    #[test]
    fn sql_literals_escape_single_quotes() {
        assert_eq!(sql_quote("it's fine"), "'it''s fine'");
    }

    #[test]
    fn approved_spec_requires_explicit_marker() {
        assert!(approved_spec("# Status: APPROVED\n"));
        assert!(!approved_spec("# Draft\nlooks good"));
    }

    #[test]
    fn truncation_is_utf8_safe() {
        let value = "é".repeat(20);
        let out = truncate(&value, 11);
        assert!(out.starts_with("ééééé"));
    }
}
