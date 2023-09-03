mod ws;
use mlua::prelude::*;

fn find_workspace_members(_: &Lua, _: ()) -> LuaResult<Vec<String>> {
    ws::ws_member_keys().map_err(|e| e.into_lua_err())
}

fn find_workspace_path(_: &Lua, member: String) -> LuaResult<String> {
    ws::ws_member_path(&member).map_err(|e| e.into_lua_err())
}

fn get_workspace_path(_: &Lua, path: String) -> LuaResult<String> {
    ws::ws_find_member(&path)
        .map_err(|e| e.into_lua_err())
        .map(|(_, v)| v)
}

fn get_workspace_label(_: &Lua, path: String) -> LuaResult<String> {
    ws::ws_find_member(&path)
        .map_err(|e| e.into_lua_err())
        .map(|(k, _)| k)
}

#[mlua::lua_module]
fn api_ws(lua: &Lua) -> LuaResult<LuaTable> {
    let exports = lua.create_table()?;
    exports.set(
        "find_workspace_members",
        lua.create_function(find_workspace_members)?,
    )?;
    exports.set(
        "find_workspace_path",
        lua.create_function(find_workspace_path)?,
    )?;
    exports.set(
        "get_workspace_path",
        lua.create_function(get_workspace_path)?,
    )?;
    exports.set(
        "get_workspace_label",
        lua.create_function(get_workspace_label)?,
    )?;
    Ok(exports)
}
