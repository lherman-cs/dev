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

### How to search for available tags?

1. ripgrep @@\w+#\w+
2. Remove values
3. Sort and uniq the results

### How to search for available values for a tag?

1. ripgrep @@<tag>#\w+
2. Sort results
