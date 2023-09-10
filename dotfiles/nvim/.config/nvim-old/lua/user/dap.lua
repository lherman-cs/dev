local dap, dapui = require("dap"), require("dapui")
dap.listeners.after.event_initialized["dapui_config"] = function()
  dapui.open()
end
dap.listeners.before.event_terminated["dapui_config"] = function()
  -- dapui.close()
end
dap.listeners.before.event_exited["dapui_config"] = function()
  -- dapui.close()
end

dap.adapters.codelldb = {
  type = 'server',
  port = "${port}",
  executable = {
    -- CHANGE THIS to your path!
    command = table.concat({ vim.fn.stdpath "data", "mason", "bin", "codelldb" }, "/"),
    args = { "--port", "${port}" },
  }
}

dap.adapters.delve = {
  type = "server",
  host = "127.0.0.1",
  port = 10001,
}

-- https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_dap.md
dap.configurations.go = {
  {
    type = "delve",
    name = "Attach",
    request = "attach",
    mode = "remote",
  } 
}

dap.configurations.cpp = {
  {
    name = "Launch file",
    type = "codelldb",
    request = "launch",
    program = function()
      return vim.fn.input('Path to executable: ', vim.fn.getcwd() .. '/', 'file')
    end,
    cwd = '${workspaceFolder}',
    stopAtEntry = true,
  }
}
dap.configurations.c = dap.configurations.cpp
dap.configurations.rust = dap.configurations.cpp


dap.adapters.python = {
  type = "executable",
    command = table.concat({ vim.fn.stdpath "data", "mason", "bin", "debugpy-adapter" }, "/"),
  -- args = {
  --   "-m",
  --   "debugpy.adapter",
  -- },
}
dap.configurations.python = {
  {
    type = 'python';
    request = 'launch';
    name = "Launch file";
    program = "${file}";
    pythonPath = function()
      return '/local/home/lukasman/.cache/pypoetry/virtualenvs/health-BpV6n-Vb-py3.8/bin/python'
    end;
  },
}
