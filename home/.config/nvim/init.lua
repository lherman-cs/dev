local home_dir = os.getenv("HOME")

local fn = vim.fn
local install_path = fn.stdpath('data') .. '/site/pack/packer/start/packer.nvim'
if fn.empty(fn.glob(install_path)) > 0 then
  packer_bootstrap = fn.system({ 'git', 'clone', '--depth', '1', 'https://github.com/wbthomason/packer.nvim',
    install_path })
end

function prequire(module, fn)
  local ok, res = pcall(require, module)
  if ok then
    fn(res)
  else
    print(module .. " doesn't exist")
  end
end

function setup_plugins(use)
  -- Automatically set up your configuration after cloning packer.nvim
  -- Put this at the end after all plugins
  if packer_bootstrap then
    require('packer').sync()
  end

  -- Packer can manage itself
  use 'wbthomason/packer.nvim'

  -- Cache modules to speed up startup time
  use 'lewis6991/impatient.nvim'
  require "impatient"

  use {
    'nvim-telescope/telescope.nvim',
    requires = { { 'nvim-lua/plenary.nvim' } }
  }

  use 'tpope/vim-surround'
  use {
    "williamboman/mason.nvim",
    "williamboman/mason-lspconfig.nvim",
    "neovim/nvim-lspconfig",
  }
  use 'hrsh7th/cmp-nvim-lsp'
  use 'hrsh7th/cmp-buffer'
  use 'hrsh7th/cmp-path'
  use 'hrsh7th/cmp-cmdline'
  use 'hrsh7th/nvim-cmp'
  use 'hrsh7th/cmp-vsnip'
  use 'hrsh7th/vim-vsnip'

  use 'folke/tokyonight.nvim'

  use {
    'kyazdani42/nvim-tree.lua',
    requires = { 'kyazdani42/nvim-web-devicons' }
  }

  use 'lewis6991/gitsigns.nvim'

  use {
    'hoob3rt/lualine.nvim',
    requires = { 'kyazdani42/nvim-web-devicons' }
  }

  use 'tpope/vim-fugitive'
  use 'tpope/vim-sleuth'
  use { "rcarriga/nvim-dap-ui", requires = { "mfussenegger/nvim-dap" } }
  use 'simrat39/rust-tools.nvim'
  use "akinsho/toggleterm.nvim"
end

function setup_lsps()
  -- Setup nvim-cmp.
  local cmp = require 'cmp'

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
  local capabilities = require('cmp_nvim_lsp').default_capabilities()
end

function setup_editor()
  vim.cmd [[colorscheme tokyonight]]

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
end

function setup_shortcuts()
  local map = vim.api.nvim_set_keymap
  options = { noremap = true }

  map('n', '<leader><leader>', ':Telescope find_files<cr>', options)
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
  map("n", "<leader>ff", "<cmd>lua vim.lsp.buf.formatting()<CR>", options)

  map("n", "g,", "<C-o>", options)
  map("n", "g.", "<C-i>", options)

  -- window management
  -- map('n', 'ss', '<cmd>split<CR><C-w>w<CR>', options)
  -- map('n', 'sv', '<cmd>vsplit<CR><C-w>w<CR>', options)
  -- map('', 'sh', '<C-w>h', options)
  -- map('', 'sk', '<C-w>k', options)
  -- map('', 'sj', '<C-w>j', options)
  -- map('', 'sl', '<C-w>l', options)

  map('n', '<C-left>', '<cmd>vertical resize -3<CR>', options)
  map('n', '<C-right>', '<cmd>vertical resize +3<CR>', options)
  map('n', '<C-up>', '<cmd>resize +3<CR>', options)
  map('n', '<C-down>', '<cmd>resize -3<CR>', options)

  -- tab management
  -- map('n', '<S-Tab>', '<cmd>tabprev<CR>', options)
  -- map('n', '<Tab>', '<cmd>tabnext<CR>', options)

  -- Git management
  map('n', '<leader>vc', ':Telescope git_commits<cr>', options)
  map('n', '<leader>vC', ':Telescope git_bcommits<cr>', options)
  -- map('n', '<leader>vC', ':Telescope git_bcommits({git_command: {"git", "log", "--abbrev_commit", "--follow"}})<cr>', options)
  map('n', '<leader>vs', ':Telescope git_status<cr>', options)
  map('n', '<leader>vS', ':Telescope git_stash<cr>', options)
  -- map('n', '<leader>gs', '<cmd>Git<CR>', options)
  -- map('n', '<leader>gc', '<cmd>Git commit<CR>', options)
  -- map('n', '<leader>gp', '<cmd>Git push<CR>', options)
  prequire('gitsigns', function(m)
    m.setup {
      on_attach = function(bufnr)
        local gs = package.loaded.gitsigns

        local function map(mode, l, r, opts)
          opts = opts or {}
          opts.buffer = bufnr
          vim.keymap.set(mode, l, r, opts)
        end

        -- Actions
        map({ 'n', 'v' }, '<leader>vh', gs.stage_hunk)
        map({ 'n', 'v' }, '<leader>vr', gs.reset_hunk)
        map({ 'n', 'v' }, '<leader>vH', gs.undo_stage_hunk)
        map('n', '<leader>vb', function() gs.blame_line { full = true } end)
      end
    }
  end)


  -- Debug
  map('n', '<leader>db', "<cmd>lua require'dap'.toggle_breakpoint()<CR>", options)
  map('n', '<leader>dc', "<cmd>lua require'dap'.continue()<CR>", options)
  map('n', '<F5>', "<cmd>lua require'dap'.continue()<CR>", options)
  map('n', '<leader>ds', "<cmd>lua require'dap'.step_over()<CR>", options)
  map('n', '<leader>di', "<cmd>lua require'dap'.step_into()<CR>", options)
  map('n', '<leader>do', "<cmd>lua require'dap'.step_out()<CR>", options)
  map('n', '<leader>di', "<cmd>lua require'dap'.repl.open()<CR>", options)
  map('n', '<leader>du', "<cmd>lua require'dapui'.toggle()<CR>", options)

end

function setup_dap()
  local dap, dapui = require("dap"), require("dapui")
  dap.listeners.after.event_initialized["dapui_config"] = function()
    dapui.open()
  end
  dap.listeners.before.event_terminated["dapui_config"] = function()
    dapui.close()
  end
  dap.listeners.before.event_exited["dapui_config"] = function()
    dapui.close()
  end

  dap.adapters.codelldb = {
    type = 'server',
    port = "${port}",
    executable = {
      -- CHANGE THIS to your path!
      command = table.concat({ vim.fn.stdpath "data", "mason", "bin", "codelldb" }, "/"),
      args = { "--port", "${port}" },
    }
  }
  dap.configurations.cpp = {
    {
      name = "Launch file",
      type = "codelldb",
      request = "launch",
      program = function()
        return vim.fn.input('Path to executable: ', vim.fn.getcwd() .. '/', 'file')
      end,
      cwd = '${workspaceFolder}',
      stopAtEntry = true,
    }
  }
  dap.configurations.c = dap.configurations.cpp
  dap.configurations.rust = dap.configurations.cpp
end

vim.g.mapleader = " "
prequire('packer', function(m) m.startup(setup_plugins) end)
prequire('lualine', function(m) m.setup {
    options = { theme = 'tokyonight' }
  }
end)
prequire('telescope', function(m) m.setup {
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

-- empty setup using defaults: add your own options
prequire('nvim-tree', function(m)
  m.setup {
    actions = {
      open_file = {
        resize_window = false
      }
    }
  }
end)

prequire('mason', function(m)
  m.setup({
    log_level = vim.log.levels.DEBUG
  })
end)

prequire('mason-lspconfig', function(m)
  m.setup()
  local lspconfig = require('lspconfig')
  m.setup_handlers {
    -- default handler - setup with default settings
    function(server_name)
      lspconfig[server_name].setup {}
    end
  }
end)

prequire('dapui', function(m)
  m.setup()
end)

setup_lsps()
setup_editor()
setup_shortcuts()
setup_dap()

prequire('rust-tools', function(m)
  m.setup({
    server = {
      on_attach = function(_, bufnr)
        -- Hover actions
        vim.keymap.set("n", "<C-space>", m.hover_actions.hover_actions, { buffer = bufnr })
        -- Code action groups
        vim.keymap.set("n", "<Leader>a", m.code_action_group.code_action_group, { buffer = bufnr })
      end,
    },
    dap = {
      adapter = require('dap').adapters.codelldb
    }
  })
end)


prequire("toggleterm", function(m)
  m.setup {
    -- size can be a number or function which is passed the current terminal
    size = function(term)
      if term.direction == "horizontal" then
        return 15
      elseif term.direction == "vertical" then
        return vim.o.columns * 0.25
      end
    end,
    open_mapping = [[<c-\>]],
    direction = "float",
  }
end)

function _G.set_terminal_keymaps()
  local opts = { buffer = 0 }
  vim.keymap.set('t', '<esc>', [[<C-\><C-n>]], opts)
  -- vim.keymap.set('t', 'jk', [[<C-\><C-n>]], opts)
  -- vim.keymap.set('t', '<C-h>', [[<Cmd>wincmd h<CR>]], opts)
  -- vim.keymap.set('t', '<C-j>', [[<Cmd>wincmd j<CR>]], opts)
  -- vim.keymap.set('t', '<C-k>', [[<Cmd>wincmd k<CR>]], opts)
  -- vim.keymap.set('t', '<C-l>', [[<Cmd>wincmd l<CR>]], opts)
end

-- if you only want these mappings for toggle term use term://*toggleterm#* instead
vim.cmd('autocmd! TermOpen term://* lua set_terminal_keymaps()')
