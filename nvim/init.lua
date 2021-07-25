require('packer').startup(function()
	-- Packer can manage itself
  	use 'wbthomason/packer.nvim'

	use {
	  'nvim-telescope/telescope.nvim',
	  requires = {{'nvim-lua/popup.nvim'}, {'nvim-lua/plenary.nvim'}}
	}

	use 'neovim/nvim-lspconfig'
	use 'hrsh7th/nvim-compe'
	use 'folke/tokyonight.nvim'

end)

vim.cmd[[colorscheme tokyonight]]

local map = vim.api.nvim_set_keymap
options = { noremap = true }

map('n', '<leader>ff', ':Telescope find_files<cr>', options)
map('n', '<leader>fg', ':Telescope live_grep<cr>', options)
map('n', '<leader>fb', ':Telescope buffers<cr>', options)
map('n', '<leader>fh', ':Telescope help_tags<cr>', options)

