local Workspace = {}

function Workspace.find_workspace_members()
	local members = {}
	local output = vim.fn.system("dev ws ls ' '")
	if vim.v.shell_error ~= 0 then
		return members
	end

	for member in string.gmatch(output, "(%S+)") do
		table.insert(members, member)
	end
	table.sort(members)
	return members
end

function Workspace.find_workspace_path(member)
	local cmd = string.gsub("dev ws path {member}", "{member}", member)
	local output = vim.fn.system(cmd)
	if vim.v.shell_error ~= 0 then
		return ""
	end

	return output
end

function Workspace.get_workspace_path(path)
	local output = vim.fn.system("dev ws find " .. path .. " 2> /dev/null")
	if vim.v.shell_error ~= 0 then
		return ""
	end

	local tokens = vim.fn.split(output, '=')
	return tokens[2]
end

function Workspace.get_workspace_label(path)
	local output = vim.fn.system("dev ws find " .. path .. " 2> /dev/null")
	if vim.v.shell_error ~= 0 then
		return ""
	end

	local tokens = vim.fn.split(output, '=')
	return tokens[1]
end

return Workspace
