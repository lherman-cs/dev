local map = vim.api.nvim_set_keymap
options = { noremap = true }

vim.g.mapleader = " "
map('n', '<leader>w<leader>', ':Telescope workspace find_files_in_workspace<cr>', options)
map('n', '<leader><leader>', ':Telescope find_files<cr>', options)
map('n', '<leader>fs', ':Telescope current_buffer_fuzzy_find case_mode=ignore_case<cr>', options)
map('n', '<leader>wg', ':Telescope workspace live_grep_in_workspace<cr>', options)
map('n', '<leader>fw', ':Telescope workspace find_workspaces<cr>', options)
map('n', '<leader>fg', ':Telescope live_grep<cr>', options)
map('n', '<leader>fb', ':Telescope buffers<cr>', options)
map('n', '<leader>fd', ':Telescope diagnostics<cr>', options)
map('n', '<leader>fm', ':Telescope marks<cr>', options)
map('n', '<leader>fh', ':Telescope help_tags<cr>', options)
map('n', '<leader>ee', ':NvimTreeToggle<cr>', options)
map('n', '<leader>ef', ':NvimTreeFindFile<cr>', options)

-- lsp shortcuts
map('n', 'gd', ':Telescope lsp_definitions<cr>', options)
map('n', 'K', '<Cmd>lua vim.lsp.buf.hover()<CR>', options)
map('n', 'gi', ':Telescope lsp_implementations<cr>', options)
map('n', '<leader>rn', '<cmd>lua vim.lsp.buf.rename()<CR>', options)
map('n', 'gr', ':Telescope lsp_references<CR>', options)
map("n", "<leader>ff", "<cmd>lua vim.lsp.buf.format()<CR>", options)

map("n", "g,", "<C-o>", options)
map("n", "g.", "<C-i>", options)

map('n', '<C-left>', '<cmd>vertical resize -3<CR>', options)
map('n', '<C-right>', '<cmd>vertical resize +3<CR>', options)
map('n', '<C-up>', '<cmd>resize +3<CR>', options)
map('n', '<C-down>', '<cmd>resize -3<CR>', options)

-- Git management
map('n', '<leader>vc', ':Telescope git_commits<cr>', options)
map('n', '<leader>vC', ':Telescope git_bcommits<cr>', options)
map('n', '<leader>vs', ':Telescope git_status<cr>', options)
map('n', '<leader>vS', ':Telescope git_stash<cr>', options)

-- Debug
map('n', '<leader>db', "<cmd>lua require'dap'.toggle_breakpoint()<CR>", options)
map('n', '<leader>dc', "<cmd>lua require'dap'.continue()<CR>", options)
map('n', '<F5>', "<cmd>lua require'dap'.continue()<CR>", options)
map('n', '<leader>ds', "<cmd>lua require'dap'.step_over()<CR>", options)
map('n', '<leader>di', "<cmd>lua require'dap'.step_into()<CR>", options)
map('n', '<leader>do', "<cmd>lua require'dap'.step_out()<CR>", options)
map('n', '<leader>di', "<cmd>lua require'dap'.repl.open()<CR>", options)
map('n', '<leader>du', "<cmd>lua require'dapui'.toggle()<CR>", options)

-- Config reload
map('n', '<leader>sv', ":source $MYVIMRC<cr>", options)

-- Tab management
map('n', '<leader>tc', ':tabclose<CR>', options)
map('n', '<leader>tn', ':tabnew<CR>', options)
map('n', '<leader>to', ':tabonly<cr>', options)
map('n', '<leader>tm', ':tabmove<Space>', options)
-- Go to tab by number
map('n', '<leader>1', '1gt', options)
map('n', '<leader>2', '2gt', options)
map('n', '<leader>3', '3gt', options)
map('n', '<leader>4', '4gt', options)
map('n', '<leader>5', '5gt', options)
map('n', '<leader>6', '6gt', options)
map('n', '<leader>7', '7gt', options)
map('n', '<leader>8', '8gt', options)
map('n', '<leader>9', '9gt', options)
map('n', '<leader>0', ':tablast<cr>', options)

