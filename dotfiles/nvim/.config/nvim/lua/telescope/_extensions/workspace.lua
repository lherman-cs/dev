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
  for k, _ in pairs(tbl) do
    table.insert(new_tbl, k)
  end
  return new_tbl
end

-- our picker function: colors
local workspace_picker = function()
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
          vim.cmd("Neotree dir=" .. workspace_path)
        end)
        return true
      end,
    })
    :find()
end

return require("telescope").register_extension({
  exports = {
    find_workspaces = workspace_picker,
  },
})
