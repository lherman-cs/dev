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

          -- lazy vim uses an internal root finding based on these:
          -- * lsp workspace folders
          -- * lsp root_dir
          -- * root pattern of filename of the current buffer
          -- * root pattern of cwd
          -- https://github.com/LazyVim/LazyVim/blob/50626e30925909450bbfe934d1a50e1d34d007c7//lua/lazyvim/util/root.lua#L166-L173
          --
          -- So, changing the buffer should trigger the change in root detection
          local contents = vim.split(vim.fn.glob(workspace_path .. "/*"), "\n", { trimempty = true })
          for i = 1, #contents do
            if vim.fn.isdirectory(contents[i]) == 0 then
              vim.cmd.edit(contents[i])
              return
            end
          end

          vim.cmd.edit(workspace_path)
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
