package ws

import (
	_ "embed"
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/urfave/cli/v2"
)

const (
	configName      = ".workspace.toml"
	defaultResolver = "fd -t d '.git' --hidden | xargs dirname"
)

//go:embed Makefile
var makefileTemplate []byte

const makefileFilename = "Makefile"

var skipList = []string{
	"build",
	"tmp",
}

func Command() *cli.Command {
	return &cli.Command{
		Name:  "ws",
		Usage: "workspace actions",
		Subcommands: []*cli.Command{
			{
				Name:   "init",
				Usage:  "init workspace",
				Action: cmdInit,
			},
			{
				Name:   "set",
				Usage:  "set a workspace member",
				Action: cmdSet,
			},
			{
				Name:   "rm",
				Usage:  "remove a workspace member",
				Action: cmdRemove,
			},
			{
				Name:    "run",
				Aliases: []string{"r"},
				Usage:   "run a given task group in a tmux",
			},
			{
				Name:    "path",
				Aliases: []string{"p"},
				Usage:   "get the workspace member's absolute path",
				Action:  cmdPath,
			},
			{
				Name:    "show",
				Aliases: []string{"sh"},
				Usage:   "get a list of registered workspace members",
				Action:  cmdShow,
			},
			{
				Name:   "ls",
				Usage:  "get a list of registered workspace members separated by a character",
				Action: cmdList,
			},
			{
				Name:   "sync",
				Usage:  "automatically synchronize current workspace by looking git projects recursively",
				Action: cmdSync,
			},
			{
				Name:   "find",
				Usage:  "find current workspace key",
				Action: cmdFind,
			},
		},
	}
}

type Task struct {
	Workspace    string `toml:"workspace"`
	Command      string `toml:"command"`
	Dependencies []string
}

type Config struct {
	path     string
	Resolver string            `toml:"resolver"`
	Members  map[string]string `toml:"members"`
	Tasks    map[string]Task   `toml:"tasks"`
}

func (cfg *Config) commit() error {
	f, err := os.OpenFile(cfg.path, os.O_RDWR|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("failed to commit %s config: %v", cfg.path, err)
	}
	defer f.Close()

	err = toml.NewEncoder(f).Encode(cfg)
	if err != nil {
		return fmt.Errorf("failed to commit updated config at %s: %v", cfg.path, err)
	}
	return nil
}

func openConfig(path string) (*Config, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open %s config: %v", path, err)
	}
	defer f.Close()

	var config Config
	_, err = toml.NewDecoder(f).Decode(&config)
	if err != nil {
		return nil, fmt.Errorf("failed to parse %s: %v", path, err)
	}
	config.path = absPath
	if config.Members == nil {
		config.Members = make(map[string]string)
	}

	return &config, nil
}

func findConfigPath() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	dirPath, err := filepath.Abs(wd)
	if err != nil {
		return "", err
	}

	for {
		configPath := filepath.Join(dirPath, configName)
		info, err := os.Stat(configPath)
		if err == nil && !info.IsDir() {
			return configPath, nil
		}

		dirPath = filepath.Dir(dirPath)
		if dirPath == "/" {
			return "", fmt.Errorf("workspace has not been setup")
		}
	}
}

func openAndCommitConfig(f func(cfg *Config) error) error {
	configPath, err := findConfigPath()
	if err != nil {
		return fmt.Errorf("failed to find config path: %v", err)
	}

	cfg, err := openConfig(configPath)
	if err != nil {
		return err
	}

	err = f(cfg)
	if err != nil {
		return err
	}

	return cfg.commit()
}

func cmdInit(cliCtx *cli.Context) error {
	wd, err := os.Getwd()
	if err != nil {
		return err
	}

	f, err := os.Create(filepath.Join(wd, configName))
	if err != nil {
		return err
	}
	defer f.Close()

	var cfg Config
	cfg.Resolver = defaultResolver
	cfg.Members = make(map[string]string)
	err = toml.NewEncoder(f).Encode(&cfg)

	if _, err := os.Stat(makefileFilename); err == nil {
		return fmt.Errorf("file already exists: %s", makefileFilename)
	}

	err = os.WriteFile(makefileFilename, makefileTemplate, 0664)
	if err != nil {
		return err
	}

	return err
}

func cmdSet(cliCtx *cli.Context) error {
	return openAndCommitConfig(func(cfg *Config) error {
		workspaceMember := cliCtx.Args().Get(0)
		workspacePath := cliCtx.Args().Get(1)
		return handleSet(cfg, workspaceMember, workspacePath)
	})
}

func handleSet(cfg *Config, member string, path string) error {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("failed to find the absolute path of %s: %v", path, err)
	}

	info, err := os.Stat(absPath)
	if errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("workspace path doesn't exist at %s", absPath)
	}

	if !info.IsDir() {
		return fmt.Errorf("workspace member must be a directory")
	}

	if _, ok := cfg.Members[member]; ok {
		fmt.Printf("%s already exists, overriding it with %s\n", member, absPath)
	}

	cfg.Members[member] = absPath
	return nil
}

func cmdRemove(cliCtx *cli.Context) error {
	return openAndCommitConfig(func(cfg *Config) error {
		workspaceMember := cliCtx.Args().First()
		return handleRemove(cfg, workspaceMember)
	})
}

func handleRemove(cfg *Config, member string) error {
	delete(cfg.Members, member)
	return nil
}

func cmdPath(cliCtx *cli.Context) error {
	return openAndCommitConfig(func(cfg *Config) error {
		workspaceMember := cliCtx.Args().First()
		workspacePath, ok := cfg.Members[workspaceMember]
		if !ok {
			return fmt.Errorf("%s is not a workspace member", workspaceMember)
		}

		fmt.Print(workspacePath)
		return nil
	})
}

func cmdShow(cliCtx *cli.Context) error {
	return openAndCommitConfig(func(cfg *Config) error {
		for member, path := range cfg.Members {
			fmt.Printf("%s=%s\n", member, path)
		}
		return nil
	})
}

func cmdList(cliCtx *cli.Context) error {
	return openAndCommitConfig(func(cfg *Config) error {
		var members []string
		for member := range cfg.Members {
			members = append(members, member)
		}

		fmt.Println(strings.Join(members, cliCtx.Args().First()))
		return nil
	})
}

func cmdSync(cliCtx *cli.Context) error {
	return openAndCommitConfig(func(cfg *Config) error {
		workspaceDir := filepath.Dir(cfg.path)
		resolver := cfg.Resolver
		if resolver == "" {
			resolver = defaultResolver
		}

		fmt.Println("used resolved:", resolver)
		cmd := exec.Command("sh", "-c", resolver)
		cmd.Dir = workspaceDir
		out, err := cmd.Output()
		if err != nil {
			return err
		}
		dirs := bytes.Split(out, []byte("\n"))

		// Always override existing workspace setting
		cfg.Members = make(map[string]string)
		for _, dir := range dirs {
			if len(dir) == 0 {
				continue
			}
			dir := string(dir)
			key := filepath.Base(dir)
			path, err := filepath.Abs(dir)
			if err != nil {
				return err
			}
			cfg.Members[key] = path
			fmt.Printf("%s=%s\n", key, path)
		}

		return nil
	})
}

func cmdFind(cliCtx *cli.Context) error {
	return openAndCommitConfig(func(cfg *Config) error {
		toFind := cliCtx.Args().Get(0)
		var matches []string
		for member, memberPath := range cfg.Members {
			// FIXME: in nix neovim, pwd is aliases to /local/home instead of /home
			// So, prefix matching won't work.
			if strings.Contains(toFind, memberPath) {
				matches = append(matches, member)
			}
		}

		longestPath := ""
		longestMember := ""
		for _, member := range matches {
			path := cfg.Members[member]

			// No need to split the path as they all share the same prefix
			if len(path) > len(longestPath) {
				longestPath = path
				longestMember = member
			}
		}

		if longestPath == "" {
			return fmt.Errorf("failed to find a related workspace member")
		}

		fmt.Printf("%s=%s", longestMember, longestPath)
		return nil
	})
}
