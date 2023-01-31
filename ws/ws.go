package ws

import (
	"bytes"
	"errors"
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/nanmu42/limitio"
	"github.com/urfave/cli/v2"
)

const (
	configName = ".workspace.toml"
)

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
				Name:    "exec",
				Aliases: []string{"e"},
				Usage:   "execute shell command on each workspace member",
				Action:  cmdExec,
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
		},
	}
}

type Config struct {
	path    string
	Members map[string]string `toml:"members"`
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

	return nil
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

func cmdExec(cliCtx *cli.Context) error {
	return openAndCommitConfig(func(cfg *Config) error {
		members := make([]string, len(cfg.Members))
		stdouts := make([]bytes.Buffer, len(cfg.Members))
		queue := make(chan int)
		var i int

		execCmd := cliCtx.Args().Get(0)
		for member, path := range cfg.Members {
			childId := i
			members[childId] = member
			path := path
			i++

			go func() {
				// FIXME: Parameterize buffer sizes
				wrappedStdout := limitio.NewWriter(&stdouts[childId], 8192, true)

				cmd := exec.Command("zsh", "-c", execCmd)
				cmd.Dir = path
				// FIXME: Separate stdout and stderr. Needs to synchronize the outputs though.
				cmd.Stdout = wrappedStdout
				cmd.Stderr = wrappedStdout
				cmd.Run()
				queue <- childId
			}()
		}

		for range cfg.Members {
			childId := <-queue
			member := members[childId]
			path := cfg.Members[member]
			fmt.Printf("===> %s: %s\n", member, path)
			fmt.Println(stdouts[childId].String())
			fmt.Println()
		}
		return nil
	})
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

// findGitProjects recursively finds paths to git projects from root
func findGitProjects(root string) ([]string, error) {
	stack := []string{root}
	var gitProjects []string

	for len(stack) > 0 {
		currentDir := stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		children, err := ioutil.ReadDir(currentDir)
		if err != nil {
			return nil, err
		}

		var toSearch []string
		for _, child := range children {
			if !child.IsDir() {
				continue
			}

			// don't follow links
			if child.Mode() & os.ModeSymlink == 1 {
				continue
			}

			if child.Name() == ".git" {
				gitProjects = append(gitProjects, currentDir)
				// End search early when we find a git module. No support for git submodules.
				toSearch = nil
				break
			}

			childPath := filepath.Join(currentDir, child.Name())
			toSearch = append(toSearch, childPath)
		}

		stack = append(stack, toSearch...)
	}

	return gitProjects, nil
}

func cmdSync(cliCtx *cli.Context) error {
	return openAndCommitConfig(func(cfg *Config) error {
		workspaceDir := filepath.Dir(cfg.path)

		// Look for all git projects and automatically add them to workspace, and prune
		// missing links
		gitProjects, err := findGitProjects(workspaceDir)
		if err != nil {
			return fmt.Errorf("failed to find git projects: %v", err)
		}

		// Always override existing workspace setting
		cfg.Members = make(map[string]string)
		for _, gitProject := range gitProjects {
			key := filepath.Base(gitProject)
			cfg.Members[key] = gitProject
			fmt.Printf("%s=%s\n", key, gitProject)
		}

		return nil
	})
}
