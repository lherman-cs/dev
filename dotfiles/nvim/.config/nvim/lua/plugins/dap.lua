-- return {
--   "mfussenegger/nvim-dap",
--   config = function()
--     -- setup dap config by VsCode launch.json file
--     require("dap.ext.vscode").load_launchjs()
--     print("dap.ext.vscode loaded")
--   end,
-- }
return {
  "mfussenegger/nvim-dap",
  keys = {
    {
      "<leader>dc",
      function()
        -- https://github.com/mfussenegger/nvim-dap/issues/20#issuecomment-1356791734
        -- setup dap config by VsCode launch.json file
        local type_to_filetypes = {}
        type_to_filetypes["codelldb"] = { "c", "cpp" }
        require("dap.ext.vscode").load_launchjs(nil, type_to_filetypes)
        require("dap").continue()
      end,
      desc = "Continue",
    },
  },
}
