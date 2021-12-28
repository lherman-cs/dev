local home_dir = os.getenv("HOME")

function prequire(module, fn)
  local ok, res = pcall(require, module)
  if ok then
    fn(res)
  else
    print(module .. " doesn't exist") 
  end
end

function set(cmd)
	vim.api.nvim_command('set ' .. cmd)
end

function setup_plugins()
	-- Packer can manage itself
  use 'wbthomason/packer.nvim'

	use {
	  'nvim-telescope/telescope.nvim',
	  requires = {{'nvim-lua/popup.nvim'}, {'nvim-lua/plenary.nvim'}}
	}

	use 'neovim/nvim-lspconfig'
  use 'hrsh7th/cmp-nvim-lsp'
  use 'hrsh7th/cmp-buffer'
  use 'hrsh7th/cmp-path'
  use 'hrsh7th/cmp-cmdline'
  use 'hrsh7th/nvim-cmp'
  use 'hrsh7th/cmp-vsnip'
  use 'hrsh7th/vim-vsnip'
 
 	use 'folke/tokyonight.nvim'
 
   use {
    'hoob3rt/lualine.nvim',
    requires = {'kyazdani42/nvim-web-devicons'}
  }

  use {
    'lewis6991/gitsigns.nvim',
    requires = {
      'nvim-lua/plenary.nvim'
    }
  }

  use 'preservim/nerdtree'

  use {
	  "folke/todo-comments.nvim",
	  requires = "nvim-lua/plenary.nvim",
  }
end

function setup_lsps()
  require'lspconfig'.gopls.setup{}
  require'lspconfig'.rust_analyzer.setup{}
  require'lspconfig'.tsserver.setup{}
  require'lspconfig'.ccls.setup{}

  vim.o.completeopt = 'menuone,noselect'
  end)

  local t = function(str)
    return vim.api.nvim_replace_termcodes(str, true, true, true)
  end

  local check_back_space = function()
      local col = vim.fn.col('.') - 1
      return col == 0 or vim.fn.getline('.'):sub(col, col):match('%s') ~= nil
  end

  -- Use (s-)tab to:
  --- move to prev/next item in completion menuone
  --- jump to prev/next snippet's placeholder
  _G.tab_complete = function()
    if vim.fn.pumvisible() == 1 then
      return t "<C-n>"
    elseif vim.fn['vsnip#available'](1) == 1 then
      return t "<Plug>(vsnip-expand-or-jump)"
    elseif check_back_space() then
      return t "<Tab>"
    else
      return vim.fn['compe#complete']()
    end
  end
  _G.s_tab_complete = function()
    if vim.fn.pumvisible() == 1 then
      return t "<C-p>"
    elseif vim.fn['vsnip#jumpable'](-1) == 1 then
      return t "<Plug>(vsnip-jump-prev)"
    else
      -- If <S-Tab> is not working in your terminal, change it to <C-h>
      return t "<S-Tab>"
    end
  end

  vim.api.nvim_set_keymap("i", "<Tab>", "v:lua.tab_complete()", {expr = true})
  vim.api.nvim_set_keymap("s", "<Tab>", "v:lua.tab_complete()", {expr = true})
  vim.api.nvim_set_keymap("i", "<S-Tab>", "v:lua.s_tab_complete()", {expr = true})
  vim.api.nvim_set_keymap("s", "<S-Tab>", "v:lua.s_tab_complete()", {expr = true})
end

function setup_editor() 
  vim.cmd[[colorscheme tokyonight]]

  set('hidden')

  -- Some servers have issues with backup files, see #649.
  set('nobackup')
  set('nowritebackup')

  -- Give more space for displaying messages.
  set('cmdheight=2')

  -- Having longer updatetime (default is 4000 ms = 4 s) leads to noticeable
  -- delays and poor user experience.
  set('updatetime=100')

  -- Don't pass messages to |ins-completion-menu|.
  set('shortmess+=c')

  -- Always show the signcolumn, otherwise it would shift the text each time
  -- diagnostics appear/become resolved.
  set('signcolumn=yes')

  -- editor settings
  set('tabstop=2 shiftwidth=2 expandtab')
  set('relativenumber')

  -- performmance stuff
  set('ttyfast')
  set('lazyredraw')

  -- storage backup
  set('undofile')
  set('undodir=' .. home_dir .. '/.vim/undo')

  -- spacing
  set('tabstop=2')
  set('expandtab')       -- Use softtabstop spaces instead of tab characters for indentation
  set('shiftwidth=2')    -- Indent by 2 spaces when using >>, <<, == etc.
  set('softtabstop=2')   -- Indent by 2 spaces when pressing <TAB>
  
  set('autoindent')      -- Keep indentation from previous line
  set('smartindent')     -- Automatically inserts indentation in some cases
  set('cindent')         -- Like smartindent, but stricter and more customisable

  set('timeoutlen=1000 ttimeoutlen=0')

  -- IDE related
  set('completeopt=menu,menuone,noselect')
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
end

prequire('telescope', function(m) m.setup{
  defaults = {
    vimgrep_arguments = {
      'rg',
      '-i',
      '--color=never',
      '--no-heading',
      '--with-filename',
      '--line-number',
      '--column'
    },
    prompt_prefix = "> ",
    selection_caret = "> ",
    entry_prefix = "  ",
    initial_mode = "insert",
    selection_strategy = "reset",
    sorting_strategy = "descending",
    layout_strategy = "horizontal",
    layout_config = {
      horizontal = {
        mirror = false,
      },
      vertical = {
        mirror = false,
      },
    },
    file_sorter =  require'telescope.sorters'.get_fuzzy_file,
    file_ignore_patterns = {},
    generic_sorter =  require'telescope.sorters'.get_generic_fuzzy_sorter,
    winblend = 0,
    border = {},
    borderchars = { '─', '│', '─', '│', '╭', '╮', '╯', '╰' },
    color_devicons = true,
    use_less = true,
    path_display = {},
    set_env = { ['COLORTERM'] = 'truecolor' }, -- default = nil,
    file_previewer = require'telescope.previewers'.vim_buffer_cat.new,
    grep_previewer = require'telescope.previewers'.vim_buffer_vimgrep.new,
    qflist_previewer = require'telescope.previewers'.vim_buffer_qflist.new,

    -- Developer configurations: Not meant for general override
    buffer_previewer_maker = require'telescope.previewers'.buffer_previewer_maker
  }
}
end)
prequire('packer', function(m) m.startup(setup_plugins) end)
prequire('lualine', function(m) m.setup{
  options = {theme = 'dracula'}
}
end)

prequire('gitsigns', function(m) m.setup() end)
prequire('todo-comments', function(m) m.setup() end)
setup_lsps()
setup_editor()
setup_shortcuts()
