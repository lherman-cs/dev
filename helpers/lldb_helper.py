import lldb
import shlex
from socket import ntohs
from collections import Counter

MODULE_NAME='lldb_helper'
NAMESPACE='h_'

'''
usage: ip4 <address>
args:
    address: a byte array in network byte order with a length of 4
'''
def ip4(debugger, command, exe_ctx, *_):
    args = shlex.split(command)
    address = args[0]

    frame = exe_ctx.frame
    va = frame.GetValueForVariablePath(address)
    octets = va.GetData().uint8s[:4]
    print(".".join(map(str, octets)))

'''
usage: ip6 <address>
args:
    address: a byte array in network byte order with a length of 16
'''
def ip6(debugger, command, exe_ctx, *_):
    args = shlex.split(command)
    address = args[0]

    frame = exe_ctx.frame
    va = frame.GetValueForVariablePath(address)
    data = va.GetData().uint16s[:8]
    octets = []
    for octet in data:
        host_order = ntohs(octet)
        octet = "{:04x}".format(host_order)
        octets.append(octet)
    print(":".join(map(str, octets)))


'''
<breakpoint_id>: (counter, limit, done)
'''
most_caller_table = dict()

'''
usage: most_caller <location> <limit>
args:
    location: a string of where to put a breakpoint, which is being used to increment the counter
    limit: an int which is being used to decide the most caller
'''
def most_caller(debugger, command, exe_ctx, *_):
    global most_caller_table

    args = shlex.split(command)
    location = args[0]
    limit = args[1]

    limit = int(limit)
    target = debugger.GetSelectedTarget()
    breakpoint = target.BreakpointCreateByName(location)
    breakpoint.SetScriptCallbackFunction('{}.{}'.format(MODULE_NAME, most_caller_callback.__name__))
    most_caller_table[breakpoint.GetID()] = (Counter(), limit, False)

def most_caller_callback(frame, bp_loc, dict):
    global most_caller_table

    parent = frame.get_parent_frame()
    fn_name = parent.GetDisplayFunctionName()
    bp_id = bp_loc.GetBreakpoint().GetID()
    counter, limit, done = most_caller_table[bp_id]
    if done:
        return False

    count = counter[fn_name]
    count += 1
    counter[fn_name] = count
    if count >= limit:
        most_callers = counter.most_common()
        padding = 40
        print('========================= Most Callers =========================')
        for fn_name, count in most_callers:
            padding_chars = ' ' * max((padding-len(fn_name)), 0)
            print('{}{}: {}'.format(fn_name, padding_chars, count))
        most_caller_table[bp_id] = (counter, limit, True)

        return True
    return False
    
def __lldb_init_module(debugger, internal_dict):
    handlers = [ip4, ip6, most_caller]
    for handler in handlers:
        debugger.HandleCommand('command script add -f {0}.{2} {1}{2}'.format(MODULE_NAME, NAMESPACE, handler.__name__))
