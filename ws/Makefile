define tmux
	tmux new-window -n $@ "source ~/.extend.rc; $(subst $\",,$(1))"
endef

echo:
	$(call tmux,"which wcd; read")
