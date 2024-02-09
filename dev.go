package main

import (
	"encoding/json"
	"errors"
	"flag"
	"log/slog"
	"os"
	"path/filepath"
)

var (
	errInvalidCmd = errors.New("expected: [init, sync, config, find]")
	errNotSetup   = errors.New("workspace has not been setup")
	errCommit     = errors.New("failed to commit config")
)

type CmdHandler func(...any) error

const (
	CONFIG_FILENAME  = "workspace.json"
	DEFAULT_RESOLVER = "fd -H '^.git$' | xargs dirname"
	MAKE_TEMPL       = `
define tmux
	tmux new-window -n $1 "source ~/.extend.rc; $(subst $\",,$(2))"
endef

define kill
    tmux kill-window -t $(1) || true
endef
`
)
const MAKE_FILENAME = "workspace.mk"

func main() {
	if err := app(); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}

func app() error {
	cmdInit := flag.NewFlagSet("init", flag.ExitOnError)
	cmdSync := flag.NewFlagSet("sync", flag.ExitOnError)
	cmdConfig := flag.NewFlagSet("config", flag.ExitOnError)
	cmdFind := flag.NewFlagSet("find", flag.ExitOnError)
	cmdFindPath := cmdFind.String("path", "", "path")

	if len(os.Args) < 2 {
		return errInvalidCmd
	}

	cmd := os.Args[1]
	args := os.Args[2:]
	switch cmd {
	case "init":
		return lazyJoin(
			func() error { return cmdInit.Parse(args) },
			cmdInitHandler,
		)
	case "sync":
		return lazyJoin(
			func() error { return cmdSync.Parse(args) },
			cmdSyncHandler,
		)
	case "config":
		return lazyJoin(
			func() error { return cmdConfig.Parse(args) },
			cmdConfigHandler,
		)
	case "find":
		return lazyJoin(
			func() error { return cmdFind.Parse(args) },
			func() error { return cmdFindHandler(*cmdFindPath) },
		)
	default:
		return errInvalidCmd
	}
}

func lazyJoin(fns ...func() error) error {
	for _, fn := range fns {
		err := fn()
		if err != nil {
			return err
		}
	}
	return nil
}

type Config struct {
	Resolver string            `json:"resolver"`
	Members  map[string]string `json:"members"`
	filepath *string
}

func (cfg *Config) Default() {
	cfg.Resolver = DEFAULT_RESOLVER
	cfg.Members = make(map[string]string)
	cfg.filepath = nil
}

func (cfg *Config) Load() error {
	dirPath, err := os.Getwd()
	if err != nil {
		return err
	}

	var configPath string
	for {
		configPath = filepath.Join(dirPath, CONFIG_FILENAME)
		info, err := os.Stat(configPath)
		if err == nil && !info.IsDir() {
			break
		}

		dirPath = filepath.Dir(dirPath)
		if dirPath == "." {
			return errNotSetup
		}
	}

	configFile, err := os.Open(configPath)
	if err == nil {
		err = errors.Join(
			json.NewDecoder(configFile).Decode(cfg),
			configFile.Close(),
		)

		if err == nil {
			cfg.filepath = &configPath
		}
	}
	return err
}

func (cfg *Config) Commit() error {
	var configPath string

	if cfg.filepath != nil {
		configPath = *cfg.filepath
	} else {
		dirPath, err := os.Getwd()
		if err != nil {
			return errors.Join(errCommit, err)
		}
		configPath = filepath.Join(dirPath, CONFIG_FILENAME)
	}

	configFile, err := os.OpenFile(configPath, os.O_RDWR|os.O_TRUNC, 0755)
	if err != nil {
		return errors.Join(errCommit, err)
	}

	err = errors.Join(
		json.NewEncoder(configFile).Encode(cfg),
		configFile.Close(),
	)
	if err != nil {
		return errors.Join(errCommit, err)
	}
	return nil
}

func cmdInitHandler() error {
	var cfg Config
	err := cfg.Load()
	if !errors.Is(err, errNotSetup) {
		return err
	}

	cfg.Default()
	return cfg.Commit()
}

func cmdSyncHandler() error {
	return nil
}

func cmdConfigHandler() error {
	var cfg Config
	err := cfg.Load()
	if err != nil {
		return err
	}

	return json.NewEncoder(os.Stdout).Encode(&cfg)
}

func cmdFindHandler(path string) error {
	return nil
}
