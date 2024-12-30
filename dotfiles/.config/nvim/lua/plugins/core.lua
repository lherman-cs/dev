return {
  { "windwp/nvim-ts-autotag", enabled = false },
  { "echasnovski/mini.pairs", enabled = false },
  {
    "tpope/vim-fugitive",
    cmd = "G",
  },
  { "catppuccin/nvim", opts = { flavour = "mocha" } },
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
    "mrcjkb/rustaceanvim",
    version = "^5", -- Recommended
    lazy = false, -- This plugin is already lazy
  },
  {
    "Duologic/nvim-jsonnet",
  },
}
