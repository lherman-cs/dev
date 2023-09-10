require "user.options"
require "user.plugins"
require "user.lsp"
require "user.dap"
require "user.keymaps"

local has_work_module = pcall(require,"work.init")
if has_work_module then
	print("Found work module")
end
