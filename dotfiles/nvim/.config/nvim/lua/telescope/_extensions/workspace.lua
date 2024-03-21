local pickers = require("telescope.pickers")
local finders = require("telescope.finders")
local conf = require("telescope.config").values
local actions = require("telescope.actions")
local action_state = require("telescope.actions.state")
local json = require("api.json")

local load_config = function()
  local cfg = vim.fn.system("dev config")
  return json.decode(cfg)
end

local keys_only = function(tbl)
  local new_tbl = {}
  for k,_ in pairs(tbl) do
    table.insert(new_tbl, k)
  end
  return new_tbl
end


-- our picker function: colors
local workspace_picker = function(hook_fn)
  local opts = {}

  local config = load_config()
  local members = keys_only(config["members"])

  pickers
    .new(opts, {
      prompt_title = "Workspace",
      finder = finders.new_table({
        results = members,
      }),
      sorter = conf.generic_sorter(opts),
      attach_mappings = function(prompt_bufnr)
        actions.select_default:replace(function()
          actions.close(prompt_bufnr)
          local selection = action_state.get_selected_entry()
          local workspace_path = config["members"][selection[1]]
          opts.cwd = workspace_path
          -- vim.api.nvim_set_current_dir(workspace_path)
          hook_fn(opts)
        end)
        return true
      end,
    })
    :find()
end

local find_project_doc = function(project_dir)
	-- TODO: Fancify the search
	local paths = vim.split(vim.fn.glob(project_dir .. '/*.md'), '\n')
	if table.getn(paths) == 0 then
		return project_dir
	end

	return paths[1]
end

local find_workspaces = function()
  local handler = function(opts)
    -- vim.cmd("e " .. opts.cwd)
    vim.cmd("e " .. find_project_doc(opts.cwd))
  end
  workspace_picker(handler)
end

return require("telescope").register_extension({
  exports = {
    find_workspaces = find_workspaces,
  },
})
