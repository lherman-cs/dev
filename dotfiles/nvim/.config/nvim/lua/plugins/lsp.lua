return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      autoformat = false,
      servers = {
        kotlin_language_server = {
          settings = {
            ['kotlin.java.opts'] = '-Xmx8g'
          }
        }
      }
    },
  },
}
