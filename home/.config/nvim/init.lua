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

  -- For luasnip users.
  use 'L3MON4D3/LuaSnip'
  use 'saadparwaiz1/cmp_luasnip'
 
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
  -- Setup nvim-cmp.
  local cmp = require'cmp'

  cmp.setup({
    snippet = {
      -- REQUIRED - you must specify a snippet engine
      expand = function(args)
        -- vim.fn["vsnip#anonymous"](args.body) -- For `vsnip` users.
        require('luasnip').lsp_expand(args.body) -- For `luasnip` users.
        -- require('snippy').expand_snippet(args.body) -- For `snippy` users.
        -- vim.fn["UltiSnips#Anon"](args.body) -- For `ultisnips` users.
      end,
    },
    mapping = {
      ['<C-b>'] = cmp.mapping(cmp.mapping.scroll_docs(-4), { 'i', 'c' }),
      ['<C-f>'] = cmp.mapping(cmp.mapping.scroll_docs(4), { 'i', 'c' }),
      ['<C-Space>'] = cmp.mapping(cmp.mapping.complete(), { 'i', 'c' }),
      ['<C-y>'] = cmp.config.disable, -- Specify `cmp.config.disable` if you want to remove the default `<C-y>` mapping.
      ['<C-e>'] = cmp.mapping({
        i = cmp.mapping.abort(),
        c = cmp.mapping.close(),
      }),
      ['<CR>'] = cmp.mapping.confirm({ select = true }), -- Accept currently selected item. Set `select` to `false` to only confirm explicitly selected items.
    },
    sources = cmp.config.sources({
      { name = 'nvim_lsp' },
      -- { name = 'vsnip' }, -- For vsnip users.
      { name = 'luasnip' }, -- For luasnip users.
      -- { name = 'ultisnips' }, -- For ultisnips users.
      -- { name = 'snippy' }, -- For snippy users.
    }, {
      { name = 'buffer' },
    })
  })

  -- Use buffer source for `/` (if you enabled `native_menu`, this won't work anymore).
  cmp.setup.cmdline('/', {
    sources = {
      { name = 'buffer' }
    }
  })

  -- Use cmdline & path source for ':' (if you enabled `native_menu`, this won't work anymore).
  cmp.setup.cmdline(':', {
    sources = cmp.config.sources({
      { name = 'path' }
    }, {
      { name = 'cmdline' }
    })
  })

  -- Setup lspconfig.
  local capabilities = require('cmp_nvim_lsp').update_capabilities(vim.lsp.protocol.make_client_capabilities())
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
prequire('telescope', function(m) m.setup{
  defaults = {
    vimgrep_arguments = {
      'rg',
      '--hidden',
      '--color=never', 
      '--no-heading',
      '--with-filename',
      '--line-number',
      '--column', 
      '--smart-case'
    }
  },
  pickers = {
    find_files = {
      hidden = true
    }
  }
}
end)
setup_lsps()
setup_editor()
setup_shortcuts()
