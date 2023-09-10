local Event = {}

local function defaultOnLspAttach(lsp_server_name, client, bufnr)
	-- explicit noop
end

Event.onLspAttach = defaultOnLspAttach

return Event
