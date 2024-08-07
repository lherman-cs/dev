return {
  { "windwp/nvim-ts-autotag", enabled = false },
  { "echasnovski/mini.pairs", enabled = false },
  {
    "tpope/vim-fugitive",
    cmd = "G",
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
