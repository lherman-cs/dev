return {
  {
    "tpope/vim-fugitive",
    cmd = "G",
  },
  { "tpope/vim-surround" },
  {
    "akinsho/toggleterm.nvim",
    config = true,
    cmd = "ToggleTerm",
    keys = { { [[<c-\>]], "<cmd>ToggleTerm<cr>", desc = "Toggle floating terminal" } },
    opts = {
      open_mapping = [[<c-\>]],
      direction = "float",
      shade_filetypes = {},
      hide_numbers = true,
      insert_mappings = true,
      terminal_mappings = true,
      start_in_insert = true,
      close_on_exit = true,
    },
  },
  {
    "rcarriga/nvim-notify",
    opts = {
      max_width = function()
        return math.floor(vim.o.columns * 0.75)
      end,
    },
  },
  { "catppuccin/nvim", opts = { flavour = "latte" } },
  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = "catppuccin",
    },
  },
  {
    "nvim-telescope/telescope.nvim",
    keys = {
      {
        "<leader>fw",
        ":Telescope workspace find_workspaces<cr>",
        desc = "Find workspaces",
      },
    },
  },
  {
    "akinsho/bufferline.nvim",
    opts = {
      options = {
        mode = "tabs",
      },
    },
  },
}
