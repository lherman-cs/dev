-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- Tab management
vim.keymap.set("n", "<leader>tc", ":tabclose<CR>", { desc = "Tab close" })
vim.keymap.set("n", "<leader>tn", ":tabnew<CR>", { desc = "Tab new" })
-- Go to tab by number
vim.keymap.set("n", "<leader>1", "1gt", { desc = "Tab go to 1" })
vim.keymap.set("n", "<leader>2", "2gt", { desc = "Tab go to 2" })
vim.keymap.set("n", "<leader>3", "3gt", { desc = "Tab go to 3" })
vim.keymap.set("n", "<leader>4", "4gt", { desc = "Tab go to 4" })
vim.keymap.set("n", "<leader>5", "5gt", { desc = "Tab go to 5" })
vim.keymap.set("v", "<leader>y", "<cmd>lua YANK_CODE_URL()<cr>", { desc = "Yank code URL" })

function YANK_CODE_URL()
  local start_line = vim.fn.line("v")
  local end_line = vim.fn.line(".")

  if start_line > end_line then
    local tmp = end_line
    end_line = start_line
    start_line = tmp
  end

  local file_path = vim.fn.expand("%:p")
  local commit_hash_cmd = string.format("cd $(dirname %s) && git rev-parse HEAD", file_path)
  local commit_hash = vim.fn.trim(vim.fn.system(commit_hash_cmd))

  -- parse from git remote
  local remote_cmd =
    string.format("cd $(dirname %s) && git remote show | head -n1 | xargs git remote get-url", file_path)
  local remote = vim.fn.system(remote_cmd)
  local website = ""
  local owner = ""
  local repo = ""

  if remote:find("^https://") ~= nil then
    -- e.g. https://github.com/lherman-cs/dev.git
    _, _, website, owner, repo = remote:find("https://(.+)/(.+)/(.+).git")
  else
    -- e.g. git@github.com:lherman-cs/dev.git
    _, _, website, owner, repo = remote:find("git@(.+):(.+)/(.+).git")
  end

  local rel_path_cmd = string.format("cd $(dirname %s) && git rev-parse --show-toplevel", file_path)
  local rel_path = vim.fn.trim(vim.fn.system(rel_path_cmd))
  local rel_path_start = vim.fn.stridx(file_path, rel_path) + string.len(rel_path) + 1
  rel_path = string.sub(file_path, rel_path_start)

  local uri = string.format(
    "https://%s/%s/%s/blob/%s/%s#L%d-L%d",
    website,
    owner,
    repo,
    commit_hash,
    rel_path,
    start_line,
    end_line
  )
  print(uri)
end
