import lldb
import shlex
from socket import ntohs
from collections import Counter

MODULE_NAME='lldb_helper'
NAMESPACE='h_'
HANDLERS = []

def ip4(debugger, command, exe_ctx, *_):
    '''
    usage: h_ip4 <address>
    args:
        address: a byte array in network byte order with a length of 4
    '''
    args = shlex.split(command)
    if len(args) != 1:
        usage(ip4)
        return
    address = args[0]

    frame = exe_ctx.frame
    va = frame.GetValueForVariablePath(address)
    octets = va.GetData().uint8s[:4]
    print(".".join(map(str, octets)))

def ip6(debugger, command, exe_ctx, *_):
    '''
    usage: h_ip6 <address>
    args:
        address: a byte array in network byte order with a length of 16
    '''
    args = shlex.split(command)
    if len(args) != 1:
        usage(ip6)
        return
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

def most_caller(debugger, command, exe_ctx, *_):
    '''
    usage: h_most_caller <location> <limit> [depth]
    args:
        location: a string of where to put a breakpoint, which is being used to increment the counter
        limit: an int which is being used to decide the most caller
        depth: an optional argument to decide how deep of the stack should be include in the counter (default: 1)
    '''
    global most_caller_table

    args = shlex.split(command)
    if not (2 <= len(args) <= 3):
        usage(most_caller)
        return
    location = args[0]
    limit = int(args[1])
    depth = int(args[2]) if len(args) == 3 else 1

    target = debugger.GetSelectedTarget()
    breakpoint = target.BreakpointCreateByName(location)
    breakpoint.SetScriptCallbackFunction('{}.{}'.format(MODULE_NAME, most_caller_callback.__name__))
    most_caller_table[breakpoint.GetID()] = (Counter(), limit, depth)

def most_caller_callback(frame, bp_loc, dict):
    global most_caller_table

    bp_id = bp_loc.GetBreakpoint().GetID()
    counter, limit, depth = most_caller_table[bp_id]

    found_most_caller = False
    frame = frame.get_parent_frame()
    while frame and depth > 0:
        fn_name = frame.GetDisplayFunctionName()
        frame = frame.get_parent_frame()
        depth -= 1

        count = counter[fn_name]
        count += 1
        counter[fn_name] = count
        if count >= limit: 
            found_most_caller = True


    if found_most_caller:
        most_callers = counter.most_common()
        padding = 40
        print('========================= Most Callers =========================')
        for fn_name, count in most_callers:
            padding_chars = ' ' * max((padding-len(fn_name)), 0)
            print('{}{}: {}'.format(fn_name, padding_chars, count))
        del most_caller_table[bp_id]

        return True
    return False

def usage(handler):
    print('{}{}\n{}\n'.format(NAMESPACE, handler.__name__, handler.__doc__))

def cmds(*_):
    '''
    usage: h_cmds
    description: list all of available commands
    '''
    global HANDLERS
    print('=========================== Commands ===========================')
    for handler in HANDLERS:
        usage(handler)
    
def __lldb_init_module(debugger, internal_dict):
    global HANDLERS
    HANDLERS = [ip4, ip6, most_caller, cmds]
    for handler in HANDLERS:
        debugger.HandleCommand('command script add -f {0}.{2} {1}{2}'.format(MODULE_NAME, NAMESPACE, handler.__name__))
