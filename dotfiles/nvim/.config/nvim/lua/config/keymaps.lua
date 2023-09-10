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
