return {
  { "windwp/nvim-ts-autotag", enabled = false },
  { "nvim-mini/mini.pairs", enabled = false },
  {
    "tpope/vim-fugitive",
    cmd = "G",
  },
  -- { "catppuccin/nvim", opts = { flavour = "mocha" }, name = "catppuccin", priority = 1000 },
  {
    "rebelot/kanagawa.nvim",
  },
  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = "kanagawa",
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
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        -- rust_analyzer = {
        --   cargo = {
        --     loadOutDirsFromCheck = true, -- needed for macro expansion
        --   },
        --   procMacro = {
        --     enable = true, -- expand procedural macros
        --   },
        --   checkOnSave = {
        --     command = "clippy", -- optional, for linting
        --   },
        -- },
      },
      inlay_hints = { enabled = false },
    },
  },
}
