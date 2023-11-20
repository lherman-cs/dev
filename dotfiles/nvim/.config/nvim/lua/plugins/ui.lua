return {
  "rcarriga/nvim-notify",
  opts = {
    max_width = function()
      return math.floor(vim.o.columns * 0.75)
    end,
  },
}
