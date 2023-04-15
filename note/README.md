# Note

Basic LSP server that gives an autocompletion (codelens) capability to Markdown files. 

## Symbol Autocompletion

Tag format: @@\w+=[^ \n\r]+ (tag=first '\w+', value=second '\w+')

The LSP will heavily utilize ripgrep to fulfil the symbol autocompletion, and will be stateless.

Goals:
1. Simple and flexible
2. Grepable, allows easy post-processing
3. Extremely fast, under 50ms to process
4. Stateless

### Filter process
1. Search files with .md extension
2. Search for "@@" in a file
3. Parse tag and value

### Why @@?
Simple and reduce search space by avoiding a single @ usage.

### Expected Speed

Let's assume that the tag search in a single file cost 1ms on CPU.
Let's assume that IO read is 200MBps, 1 byte per character, and 100 characters per line.

Within 50ms latency, 200*1e6/100*50/1000=100k lines

### How to search for available tags?

1. rg @@\w+#\w+
2. Remove values
3. Sort and uniq the results

### How to search for available values for a tag?

1. rg @@<tag>#\w+
2. Sort results


@@user#lukasman
@@user#stewaga
@@due_date#2023-12-04
