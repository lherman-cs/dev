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

  use 'folke/tokyonight.nvim'

  use {
    'kyazdani42/nvim-tree.lua',
    requires = {'kyazdani42/nvim-web-devicons'}
  }


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

  use 'tpope/vim-fugitive'
  use 'tpope/vim-sleuth'
  
end

function setup_lsps()
  -- Setup nvim-cmp.
  local cmp = require'cmp'

  cmp.setup({
    snippet = {
      -- REQUIRED - you must specify a snippet engine
      expand = function(args)
        vim.fn["vsnip#anonymous"](args.body) -- For `vsnip` users.
        -- require('luasnip').lsp_expand(args.body) -- For `luasnip` users.
        -- require('snippy').expand_snippet(args.body) -- For `snippy` users.
        -- vim.fn["UltiSnips#Anon"](args.body) -- For `ultisnips` users.
      end,
    },
    window = {
      -- completion = cmp.config.window.bordered(),
      -- documentation = cmp.config.window.bordered(),
    },
    mapping = cmp.mapping.preset.insert({
      ['<C-b>'] = cmp.mapping.scroll_docs(-4),
      ['<C-f>'] = cmp.mapping.scroll_docs(4),
      ['<C-Space>'] = cmp.mapping.complete(),
      ['<C-e>'] = cmp.mapping.abort(),
      ['<CR>'] = cmp.mapping.confirm({ select = true }), -- Accept currently selected item. Set `select` to `false` to only confirm explicitly selected items.
      ["<Tab>"] = cmp.mapping(cmp.mapping.select_next_item(), { "i", "s" }),
      ["<S-Tab>"] = cmp.mapping(cmp.mapping.select_prev_item(), { "i", "s" }),
    }),
    sources = cmp.config.sources({
      { name = 'nvim_lsp' },
      { name = 'vsnip' }, -- For vsnip users.
    }, {
      { name = 'buffer' },
    })
  })

  -- Set configuration for specific filetype.
  cmp.setup.filetype('gitcommit', {
    sources = cmp.config.sources({
      { name = 'cmp_git' }, -- You can specify the `cmp_git` source if you were installed it.
    }, {
      { name = 'buffer' },
    })
  })

  -- Use buffer source for `/` (if you enabled `native_menu`, this won't work anymore).
  cmp.setup.cmdline('/', {
    mapping = cmp.mapping.preset.cmdline(),
    sources = {
      { name = 'buffer' }
    }
  })

  -- Use cmdline & path source for ':' (if you enabled `native_menu`, this won't work anymore).
  cmp.setup.cmdline(':', {
    mapping = cmp.mapping.preset.cmdline(),
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
end

function setup_shortcuts()
  local map = vim.api.nvim_set_keymap
  options = { noremap = true }

  map('n', '<leader><leader>', ':Telescope find_files<cr>', options)
  map('n', '<leader>fg', ':Telescope live_grep<cr>', options)
  map('n', '<leader>fb', ':Telescope buffers<cr>', options)
  map('n', '<leader>fh', ':Telescope help_tags<cr>', options)
  map('n', '<leader>ee', ':NvimTreeToggle<cr>', options)
  map('n', '<leader>ef', ':NvimTreeFindFile<cr>', options)

  -- lsp shortcuts
  map('n', 'gD', '<Cmd>lua vim.lsp.buf.declaration()<CR>', options)
  map('n', 'gd', '<Cmd>lua vim.lsp.buf.definition()<CR>', options)
  map('n', 'K', '<Cmd>lua vim.lsp.buf.hover()<CR>', options)
  map('n', 'gi', '<cmd>lua vim.lsp.buf.implementation()<CR>', options)
  map('n', '<leader>D', '<cmd>lua vim.lsp.buf.type_definition()<CR>', options)
  map('n', '<leader>rn', '<cmd>lua vim.lsp.buf.rename()<CR>', options)
  map('n', 'gr', '<cmd>lua vim.lsp.buf.references()<CR>', options)
  map('n', '[g', '<cmd>lua vim.lsp.diagnostic.goto_prev()<CR>', options)
  map('n', ']g', '<cmd>lua vim.lsp.diagnostic.goto_next()<CR>', options)
  map("n", "<leader>ff", "<cmd>lua vim.lsp.buf.formatting()<CR>", options)

  map("n", "g,", "<C-o>", options)
  map("n", "g.", "<C-i>", options)

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

  -- Git management
  map('n', '<leader>gs', '<cmd>Git<CR>', options)
  map('n', '<leader>gc', '<cmd>Git commit<CR>', options)
  map('n', '<leader>gp', '<cmd>Git push<CR>', options)
end

vim.g.mapleader = " "
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
prequire('nvim-lsp-installer', function(m)
  -- Register a handler that will be called for all installed servers.
  -- Alternatively, you may also register handlers on specific server instances instead (see example below).
  m.on_server_ready(function(server)
      local opts = {}

      -- (optional) Customize the options passed to the server
      -- if server.name == "tsserver" then
      --     opts.root_dir = function() ... end
      -- end

      -- This setup() function is exactly the same as lspconfig's setup function.
      -- Refer to https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md
      server:setup(opts)
  end)
end)

prequire('gitsigns', function(m)
  m.setup {
    on_attach = function(bufnr)
      local gs = package.loaded.gitsigns

      local function map(mode, l, r, opts)
        opts = opts or {}
        opts.buffer = bufnr
        vim.keymap.set(mode, l, r, opts)
      end

      -- Navigation
      map('n', ']c', "&diff ? ']c' : '<cmd>Gitsigns next_hunk<CR>'", {expr=true})
      map('n', '[c', "&diff ? '[c' : '<cmd>Gitsigns prev_hunk<CR>'", {expr=true})

      -- Actions
      map({'n', 'v'}, '<leader>hs', gs.stage_hunk)
      map({'n', 'v'}, '<leader>hr', gs.reset_hunk)
      map('n', '<leader>hS', gs.stage_buffer)
      map('n', '<leader>hu', gs.undo_stage_hunk)
      map('n', '<leader>hR', gs.reset_buffer)
      map('n', '<leader>hp', gs.preview_hunk)
      map('n', '<leader>hb', function() gs.blame_line{full=true} end)
      map('n', '<leader>tb', gs.toggle_current_line_blame)
      map('n', '<leader>hd', gs.diffthis)
      map('n', '<leader>hD', function() gs.diffthis('~') end)
      map('n', '<leader>td', gs.toggle_deleted)

      -- Text object
      map({'o', 'x'}, 'ih', ':<C-U>Gitsigns select_hunk<CR>')
    end
  }
end)

-- empty setup using defaults: add your own options
prequire('nvim-tree', function(m)
  m.setup {
    actions = {
      open_file = {
          resize_window = true
      }
    }
  }
end)

setup_lsps()
setup_editor()
setup_shortcuts()
