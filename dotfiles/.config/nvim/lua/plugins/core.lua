return {
  { "windwp/nvim-ts-autotag", enabled = false },
  { "nvim-mini/mini.pairs", enabled = false },
  {
    "tpope/vim-fugitive",
    cmd = "G",
  },
  -- { "catppuccin/nvim", opts = { flavour = "mocha" }, name = "catppuccin", priority = 1000 },
  -- {
  --   "rebelot/kanagawa.nvim",
  -- },
  -- {
  --   "folke/tokyonight.nvim",
  --   opts = {
  --     transparent = true,
  --     styles = {
  --       sidebars = "transparent",
  --       floats = "transparent",
  --     },
  --   },
  -- },
  {
    "ellisonleao/gruvbox.nvim",
    priority = 1000,
    config = function()
      require("gruvbox").setup({
        terminal_colors = true, -- add neovim terminal colors
        invert_selection = false,
        invert_signs = false,
        invert_tabline = false,
        invert_intend_guides = false,
        inverse = true, -- invert background for search, diffs, statuslines and errors
        contrast = "hard", -- can be "hard", "soft" or empty string
        palette_overrides = {},
        overrides = {},
        dim_inactive = false,
        transparent_mode = false,
      })
      vim.cmd("colorscheme gruvbox")
    end,
  },
  {
    "LazyVim/LazyVim",
    -- opts = {
    --   colorscheme = "tokyonight",
    -- },
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
        wc_language_server = {
          autostart = true,
          filetypes = { "html", "astro", "vue", "svelte" },
          root_dir_patterns = { "wc.config.js", "package.json", ".git" },
          tsdk = vim.fn.getcwd() .. "/node_modules/typescript/lib",
        },
      },
      inlay_hints = { enabled = false },
    },
  },
}
