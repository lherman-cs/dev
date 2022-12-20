local pickers = require "telescope.pickers"
local finders = require "telescope.finders"
local conf = require("telescope.config").values
local actions = require "telescope.actions"
local action_state = require "telescope.actions.state"

local find_workspace_members = function()
	local members = {}
	local file = io.popen("dev ws ls ' '")

	if file == nil then
		return members
	end

	local output = file:read('*all')
	local rc = { file:close() }

	if not rc[1] then
		return members
	end

	for member in string.gmatch(output, "(%S+)") do
		table.insert(members, member)
	end
	table.sort(members)
	return members
end

local find_workspace_path = function(member)
	local cmd = string.gsub("dev ws path {member}", "{member}", member)
	local file = io.popen(cmd)

	if file == nil then
		return ""
	end

	local output = file:read('*all')
	local rc = { file:close() }

	if not rc[1] then
		return ""
	end

	return output
end

-- our picker function: colors
local workspace_picker = function(hook_fn)
	local opts = {}
	pickers.new(opts, {
		prompt_title = "Workspace",
		finder = finders.new_table {
			results = find_workspace_members()
		},
		sorter = conf.generic_sorter(opts),
		attach_mappings = function(prompt_bufnr)
			actions.select_default:replace(function()
				actions.close(prompt_bufnr)
				local selection = action_state.get_selected_entry()
				local workspace_path = find_workspace_path(selection[1])
				opts.cwd = workspace_path
				hook_fn(opts)
			end)
			return true
		end,
	}):find()
end


local workspace_live_grep_picker = function()
	workspace_picker(require('telescope.builtin').live_grep)
end

local workspace_find_files_picker = function()
	workspace_picker(require('telescope.builtin').find_files)
end

return require("telescope").register_extension {
	-- setup = function(ext_config, config)
	--   -- access extension config and user config
	-- end,
	exports = {
		find_files = workspace_find_files_picker,
		live_grep = workspace_live_grep_picker,
	},
}
