local pickers = require "telescope.pickers"
local finders = require "telescope.finders"
local conf = require("telescope.config").values
local actions = require "telescope.actions"
local action_state = require "telescope.actions.state"
local workspace = require("api.ws")

-- our picker function: colors
local workspace_picker = function(hook_fn)
	local opts = {}
	pickers.new(opts, {
		prompt_title = "Workspace",
		finder = finders.new_table {
			results = workspace.find_workspace_members()
		},
		sorter = conf.generic_sorter(opts),
		attach_mappings = function(prompt_bufnr)
			actions.select_default:replace(function()
				actions.close(prompt_bufnr)
				local selection = action_state.get_selected_entry()
				local workspace_path = workspace.find_workspace_path(selection[1])
				opts.cwd = workspace_path
				hook_fn(opts)
			end)
			return true
		end,
	}):find()
end

local current_workspace_picker = function(hook_fn)
	local opts = {}
	local current_path = vim.api.nvim_buf_get_name(0)
	opts.cwd = workspace.get_workspace_path(current_path)
	hook_fn(opts)
end

local find_project_doc = function(project_dir)
	-- TODO: Fancify the search
	local paths = vim.split(vim.fn.glob(project_dir .. '/*.md'), '\n')
	if table.getn(paths) == 0 then
		return ""
	end

	return paths[1]
end


local workspace_live_grep_picker = function()
	workspace_picker(require('telescope.builtin').live_grep)
end

local workspace_find_files_picker = function()
	workspace_picker(require('telescope.builtin').find_files)
end

local live_grep_in_workspace = function()
	current_workspace_picker(require('telescope.builtin').live_grep)
end

local find_files_in_workspace = function()
	current_workspace_picker(require('telescope.builtin').find_files)
end

local find_workspaces = function()
	local handler = function(opts)
		local project_doc_path = find_project_doc(opts.cwd)
		if project_doc_path == "" then
			require('telescope.builtin').find_files(opts)
		else
			vim.cmd("e " .. project_doc_path)
		end
	end
	workspace_picker(handler)
end

return require("telescope").register_extension {
	-- setup = function(ext_config, config)
	--   -- access extension config and user config
	-- end,
	exports = {
		find_files = workspace_find_files_picker,
		live_grep = workspace_live_grep_picker,
		find_workspaces = find_workspaces,
		live_grep_in_workspace = live_grep_in_workspace,
		find_files_in_workspace = find_files_in_workspace,
	},
}
