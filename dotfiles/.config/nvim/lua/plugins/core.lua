return {
  { "windwp/nvim-ts-autotag", enabled = false },
  { "echasnovski/mini.pairs", enabled = false },
  {
    "tpope/vim-fugitive",
    cmd = "G",
  },
  { "catppuccin/nvim", opts = { flavour = "mocha" }, name = "catppuccin", priority = 1000 },
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
  {
    "Duologic/nvim-jsonnet",
  },
  {
    "folke/snacks.nvim",
    opts = {
      dashboard = { enabled = false },
      scratch = { enabled = false },
      terminal = { enabled = false },
      scroll = { enabled = false },
      indent = { enabled = false },
    },
  },
}
