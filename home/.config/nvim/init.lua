local home_dir = os.getenv("HOME")

function prequire(module, fn)
  local ok, res = pcall(require, module)
  if ok then
    fn(res)
  else
    print(module .. " doesn't exist") 
  end
end

function setup_plugins()
	-- Packer can manage itself
  use 'wbthomason/packer.nvim'

	use {
	  'nvim-telescope/telescope.nvim',
    requires = { {'nvim-lua/plenary.nvim'} }
	}

	use 'neovim/nvim-lspconfig'
  use 'hrsh7th/cmp-nvim-lsp'
  use 'hrsh7th/cmp-buffer'
  use 'hrsh7th/cmp-path'
  use 'hrsh7th/cmp-cmdline'
  use 'hrsh7th/nvim-cmp'
  use 'hrsh7th/cmp-vsnip'
  use 'hrsh7th/vim-vsnip'
  use 'onsails/lspkind-nvim'
 
 	use 'folke/tokyonight.nvim'

  use 'preservim/nerdtree'

  use {
    'lewis6991/gitsigns.nvim',
    requires = {
      'nvim-lua/plenary.nvim'
    },
    -- tag = 'release' -- To use the latest release
  }

  use {
    'hoob3rt/lualine.nvim',
    requires = {'kyazdani42/nvim-web-devicons'}
  }

  use 'williamboman/nvim-lsp-installer'
end

function setup_lsps()
  require'lspconfig'.gopls.setup{}
  require'lspconfig'.rust_analyzer.setup{}
  require'lspconfig'.tsserver.setup{}
  require'lspconfig'.ccls.setup{}

  local cmp = require("cmp")
  cmp.setup({
     snippet = {
        expand = function(args)
           vim.fn["vsnip#anonymous"](args.body)
        end,
     },
     mapping = {
        ["<C-p>"] = cmp.mapping.select_prev_item(),
        ["<C-n>"] = cmp.mapping.select_next_item(),
        ["<C-d>"] = cmp.mapping.scroll_docs(-4),
        ["<C-f>"] = cmp.mapping.scroll_docs(4),
        ["<C-Space>"] = cmp.mapping.complete(),
        ["<C-e>"] = cmp.mapping.close(),
        ["<CR>"] = cmp.mapping.confirm({
           behavior = cmp.ConfirmBehavior.Replace,
           select = true,
        }),
        ["<Tab>"] = cmp.mapping(cmp.mapping.select_next_item(), { "i", "s" }),
        ["<S-Tab>"] = cmp.mapping(cmp.mapping.select_prev_item(), { "i", "s" }),
     },
     formatting = {
        format = function(_, vim_item)
           vim.cmd("packadd lspkind-nvim")
           vim_item.kind = require("lspkind").presets.codicons[vim_item.kind]
           .. "  "
           .. vim_item.kind
           return vim_item
        end,
     },
     sources = {
        { name = "nvim_lsp" },
        { name = "vsnip" },
        { name = "path" },
     },
  })
end

function setup_editor() 
  vim.cmd[[colorscheme tokyonight]]

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

  -- performmance stuff
  vim.opt.ttyfast = true
  vim.opt.lazyredraw = true

  -- storage backup
  vim.opt.undofile = true
  vim.opt.undodir = home_dir .. '/.vim/undo'

  -- spacing
  vim.opt.tabstop = 2
  vim.opt.expandtab = true  -- Use softtabstop spaces instead of tab characters for indentation
  vim.opt.shiftwidth = 2    -- Indent by 2 spaces when using >>, <<, == etc.
  vim.opt.softtabstop = 2   -- Indent by 2 spaces when pressing <TAB>
  
  vim.opt.autoindent = true      -- Keep indentation from previous line
  vim.opt.smartindent = true     -- Automatically inserts indentation in some cases
  vim.opt.cindent = true         -- Like smartindent, but stricter and more customisable

  vim.opt.timeoutlen = 1000 
  vim.opt.ttimeoutlen = 0

  -- IDE related
  vim.opt.completeopt = "menu,menuone,noselect"
end

function setup_shortcuts()
  local map = vim.api.nvim_set_keymap
  options = { noremap = true }

  map('n', '<space><space>', ':Telescope find_files<cr>', options)
  map('n', '<space>fg', ':Telescope live_grep<cr>', options)
  map('n', '<space>fb', ':Telescope buffers<cr>', options)
  map('n', '<space>fh', ':Telescope help_tags<cr>', options)
  map('n', '<space>ee', ':NERDTreeToggle<cr>', options)
  map('n', '<space>ef', ':NERDTreeFind<cr>', options)
  map('n', '<space>tt', ':TodoTelescope<cr>', options)

  -- lsp shortcuts
  map('n', 'gD', '<Cmd>lua vim.lsp.buf.declaration()<CR>', options)
  map('n', 'gd', '<Cmd>lua vim.lsp.buf.definition()<CR>', options)
  map('n', 'K', '<Cmd>lua vim.lsp.buf.hover()<CR>', options)
  map('n', 'gi', '<cmd>lua vim.lsp.buf.implementation()<CR>', options)
  map('n', '<space>D', '<cmd>lua vim.lsp.buf.type_definition()<CR>', options)
  map('n', '<space>rn', '<cmd>lua vim.lsp.buf.rename()<CR>', options)
  map('n', 'gr', '<cmd>lua vim.lsp.buf.references()<CR>', options)
  map('n', '[g', '<cmd>lua vim.lsp.diagnostic.goto_prev()<CR>', options)
  map('n', ']g', '<cmd>lua vim.lsp.diagnostic.goto_next()<CR>', options)
  map("n", "<space>ff", "<cmd>lua vim.lsp.buf.formatting()<CR>", options)

  -- window management
  map('n', 'st', '<cmd>split<CR><C-w>w<cmd>term<CR>', options)
  map('n', 'ss', '<cmd>split<CR><C-w>w<CR>', options)
  map('n', 'sv', '<cmd>vsplit<CR><C-w>w<CR>', options)
  map('', 'sh', '<C-w>h', options)
  map('', 'sk', '<C-w>k', options)
  map('', 'sj', '<C-w>j', options)
  map('', 'sl', '<C-w>l', options)

  map('n', '<C-left>', '<cmd>vertical resize -3<CR>', options)
  map('n', '<C-right>', '<cmd>vertical resize +3<CR>', options)
  map('n', '<C-up>', '<cmd>resize +3<CR>', options)
  map('n', '<C-down>', '<cmd>resize -3<CR>', options)

  -- tab management
  map('n', '<S-Tab>', '<cmd>tabprev<CR>', options)
  map('n', '<Tab>', '<cmd>tabnext<CR>', options)
end

prequire('packer', function(m) m.startup(setup_plugins) end)
prequire('lualine', function(m) m.setup{
  options = {theme = 'tokyonight'}
}
end)
prequire('gitsigns', function(m) m.setup() end)
require('telescope').setup {
  pickers = {
    find_files = {
      hidden = true
    }
  }
}

setup_lsps()
setup_editor()
setup_shortcuts()
