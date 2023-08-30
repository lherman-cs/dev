local workspace = require('api.ws')

local ensure_packer = function()
  local fn = vim.fn
  local install_path = fn.stdpath('data') .. '/site/pack/packer/start/packer.nvim'
  if fn.empty(fn.glob(install_path)) > 0 then
    fn.system({ 'git', 'clone', '--depth', '1', 'https://github.com/wbthomason/packer.nvim', install_path })
    vim.cmd [[packadd packer.nvim]]
    return true
  end
  return false
end

local packer_bootstrap = ensure_packer()


function setup_plugins(use)
  -- Packer can manage itself
  use 'wbthomason/packer.nvim'

  use {
    'nvim-telescope/telescope.nvim',
    requires = { { 'nvim-lua/plenary.nvim' } }
  }
  use {
    'rmagatti/auto-session',
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

  -- theme
  use "EdenEast/nightfox.nvim"
  use "ellisonleao/gruvbox.nvim"

  -- use osc52 for clipboard than relying on X11
  use 'ojroques/nvim-osc52'

  use({
    "iamcco/markdown-preview.nvim",
    run = function() vim.fn["mkdp#util#install"]() end,
  })

  -- Automatically set up your configuration after cloning packer.nvim
  -- Put this at the end after all plugins
  if packer_bootstrap then
    require('packer').sync()
  end
end

require('packer').startup(setup_plugins)

local find_current_workspace = function()
  -- TODO: This gets polled every second. Maybe optimize this in the future?
  local tabs = vim.api.nvim_list_tabpages()
  local tabline = {}

  for i, tab in ipairs(tabs) do
      local window = vim.api.nvim_tabpage_get_win(tab)
      local buffer = vim.api.nvim_win_get_buf(window)
      local filename = vim.api.nvim_buf_get_name(buffer)
      local current_workspace = workspace.current_workspace_label(filename)
      
      local workspace_formatted = string.format("%d=%s", i, current_workspace)
      table.insert(tabline, workspace_formatted)
  end

  local tabs = table.concat(tabline, " ")
  return "[" .. tabs .. "]"
end

require('lualine').setup {
  options = { theme = 'nord' },
  extensions = {
    'fugitive',
    'nvim-dap-ui',
    'nvim-tree',
    'toggleterm'
  },
  sections = {
    lualine_c = {
      find_current_workspace,
      {
        'filename',
        path = 1,
      }
    }
  }
}

require('telescope').load_extension('workspace')
require('telescope').setup {
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

-- empty setup using defaults: add your own options
-- require('nvim-tree').setup {
--   actions = {
--     open_file = {
--       resize_window = false
--     }
--   }
-- }
-- disable netrw at the very start of your init.lua (strongly advised)
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

-- set termguicolors to enable highlight groups
vim.opt.termguicolors = true

-- empty setup using defaults
require("nvim-tree").setup()

require('mason').setup()

local configs = require "lspconfig.configs"
local util = require "lspconfig.util"

configs.note = {
    default_config = {
        cmd = { "dev", "note", "start" },
        filetypes = { "markdown" },
        root_dir = util.path.dirname,
    },
    -- on_new_config = function(new_config) end;
    -- on_attach = function(client, bufnr) end;
    docs = {
        description = [[
        Simple note taking lsp
]],
        default_config = {
            root_dir = [[root_pattern(".git")]],
        },
    },
}
require'lspconfig'.note.setup {}

local mason_lsp = require('mason-lspconfig')
local lspconfig = require('lspconfig')
-- vim.lsp.set_log_level("trace")
mason_lsp.setup()
mason_lsp.setup_handlers {
  function(server_name)
    lspconfig[server_name].setup {
      on_attach = function(client, bufnr)
        require('api.event').onLspAttach(server_name, client, bufnr)
      end
    }
  end
}
require('dapui').setup()

local rt = require('rust-tools')

rt.setup({
  server = {
    on_attach = function(_, bufnr)
      -- Hover actions
      vim.keymap.set("n", "<C-space>", rt.hover_actions.hover_actions, { buffer = bufnr })
      -- Code action groups
      vim.keymap.set("n", "<Leader>a", rt.code_action_group.code_action_group, { buffer = bufnr })
    end,
  },
  dap = {
    adapter = require('dap').adapters.codelldb
  }
})


require("toggleterm").setup {
  -- size can be a number or function which is passed the current terminal
  size = function(term)
    if term.direction == "horizontal" then
      return 15
    elseif term.direction == "vertical" then
      return vim.o.columns * 0.25
    end
  end,
  open_mapping = [[<C-\>]],
  direction = "float",
}

require("auto-session").setup {
  log_level = "error",
  auto_session_suppress_dirs = { "~/", "~/Projects", "~/Downloads", "/"},
}

function _G.set_terminal_keymaps()
  local opts = { buffer = 0 }
  vim.keymap.set('t', [[<esc><esc>]], [[<C-\><C-n>]], opts)
  -- vim.keymap.set('t', 'jk', [[<C-\><C-n>]], opts)
  -- vim.keymap.set('t', '<C-h>', [[<Cmd>wincmd h<CR>]], opts)
  -- vim.keymap.set('t', '<C-j>', [[<Cmd>wincmd j<CR>]], opts)
  -- vim.keymap.set('t', '<C-k>', [[<Cmd>wincmd k<CR>]], opts)
  -- vim.keymap.set('t', '<C-l>', [[<Cmd>wincmd l<CR>]], opts)
end

-- if you only want these mappings for toggle term use term://*toggleterm#* instead
vim.cmd('autocmd! TermOpen term://* lua set_terminal_keymaps()')

-- Themes
-- vim.o.background = "dark" -- or "light" for light mode
-- vim.cmd("colorscheme gruvbox")
vim.cmd("colorscheme nordfox")
