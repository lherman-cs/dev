local home_dir = os.getenv("HOME")
-- vim.cmd [[colorscheme onedark]]

-- Hide files in the background instead of closing them.
vim.opt.hidden = true

-- Some servers have issues with backup files, see #649.
-- vim.opt.nobackup = true
-- vim.opt.nowritebackup = true

-- Give more space for displaying messages.
vim.opt.cmdheight = 2

-- Having longer updatetime (default is 4000 ms = 4 s) leads to noticeable
-- delays and poor user experience.
vim.opt.updatetime = 100

-- Always show the signcolumn, otherwise it would shift the text each time
-- diagnostics appear/become resolved.
vim.opt.signcolumn = "yes"

-- editor settings
vim.opt.relativenumber = true

-- storage backup
vim.opt.undofile = true
vim.opt.undodir = home_dir .. '/.vim/undo'

-- spacing
-- vim.opt.tabstop = 2
-- vim.opt.shiftwidth = 2    -- Indent by 2 spaces when using >>, <<, == etc.
-- vim.opt.softtabstop = 2   -- Indent by 2 spaces when pressing <TAB>
-- vim.opt.expandtab = true  -- Use softtabstop spaces instead of tab characters for indentation
-- vim.opt.smarttab = true

-- vim.opt.autoindent = true      -- Keep indentation from previous line
-- vim.opt.smartindent = true     -- Automatically inserts indentation in some cases
-- vim.opt.cindent = true         -- Like smartindent, but stricter and more customisable

vim.opt.timeoutlen = 1000
vim.opt.ttimeoutlen = 0

-- IDE related
vim.opt.completeopt = "menu,menuone,noselect"

vim.opt.cursorcolumn = true
vim.opt.cursorline = true
vim.opt.diffopt = vim.opt.diffopt + "vertical"
-- vim.opt.termguicolors = false
