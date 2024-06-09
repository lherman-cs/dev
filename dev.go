package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
	"time"
)

var (
	errInvalidCmd = errors.New("expected: [init, sync, config, run, find, link]")
	errNotSetup   = errors.New("workspace has not been setup")
	errCommit     = errors.New("failed to commit config")
)

type CmdHandler func(...any) error

const (
	CONFIG_FILENAME  = "workspace.json"
	DEFAULT_RESOLVER = "fd -H '^.git$' | xargs -I{} dirname {}"
	MAKE_TEMPLATE    = `
define tmux
	tmux new-window -n $1 "source ~/.extend.rc; $(subst $\",,$(2))"
endef

define kill
    tmux kill-window -t $(1) || true
endef

{{range $member, $path := .}}
{{ $member }} := {{ $path }}
{{- end}}
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
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	homedir, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	cmdInit := flag.NewFlagSet("init", flag.ExitOnError)
	cmdSync := flag.NewFlagSet("sync", flag.ExitOnError)
	cmdConfig := flag.NewFlagSet("config", flag.ExitOnError)
	cmdRun := flag.NewFlagSet("run", flag.ExitOnError)
	cmdRunWorkflow := cmdRun.String("workflow", "", "workflow")

	cmdFind := flag.NewFlagSet("find", flag.ExitOnError)
	cmdFindPath := cmdFind.String("path", "", "path")

	cmdLink := flag.NewFlagSet("link", flag.ExitOnError)
	cmdLinkFrom := cmdLink.String("from", cwd, "from")
	cmdLinkTo := cmdLink.String("to", homedir, "to")
	cmdLinkReal := cmdLink.Bool("real", false, "real")
	cmdLinkForce := cmdLink.Bool("force", false, "force will try to override existing files")

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
	case "run":
		return lazyJoin(
			func() error { return cmdRun.Parse(args) },
			func() error { return cmdRunHandler(*cmdRunWorkflow) },
		)
	case "find":
		return lazyJoin(
			func() error { return cmdFind.Parse(args) },
			func() error { return cmdFindHandler(*cmdFindPath) },
		)
	case "link":
		return lazyJoin(
			func() error { return cmdLink.Parse(args) },
			func() error { return cmdLinkHandler(*cmdLinkFrom, *cmdLinkTo, *cmdLinkReal, *cmdLinkForce) },
		)
	case "log":
		return cmdLogHandler(args)
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

type JobResult struct {
	StartAt  time.Time
	Workflow string
	Job      string
	LogPath  string
	Err      error
}

type Jobs map[string]string

type Config struct {
	Resolver  string            `json:"resolver"`
	Members   map[string]string `json:"members"`
	Workflows map[string]Jobs   `json:"workflows"`
	dirPath   *string
}

func (cfg *Config) Default() {
	cfg.Resolver = DEFAULT_RESOLVER
	cfg.Members = make(map[string]string)
	cfg.Workflows = make(map[string]Jobs)
	cfg.Workflows["echo"] = Jobs{
		"resolver": "echo \"{{.Resolver}}\"",
	}
	cfg.dirPath = nil
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
		if dirPath == "/" {
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
			cfg.dirPath = &dirPath
		}
	}
	return err
}

func (cfg *Config) Commit() error {
	var configDir string

	if cfg.dirPath != nil {
		configDir = *cfg.dirPath
	} else {
		dirPath, err := os.Getwd()
		if err != nil {
			return errors.Join(errCommit, err)
		}
		configDir = dirPath
	}

	configPath := filepath.Join(configDir, CONFIG_FILENAME)
	configFile, err := os.OpenFile(configPath, os.O_RDWR|os.O_TRUNC|os.O_CREATE, 0755)
	if err != nil {
		return errors.Join(errCommit, err)
	}

	jsonEncoder := json.NewEncoder(configFile)
	jsonEncoder.SetIndent("", "    ")
	err = errors.Join(
		jsonEncoder.Encode(cfg),
		configFile.Close(),
	)
	if err != nil {
		return errors.Join(errCommit, err)
	}

	makeTag := ""
	makeTempl, err := template.New(makeTag).Parse(MAKE_TEMPLATE)
	if err != nil {
		return errors.Join(errCommit, err)
	}

	makePath := filepath.Join(configDir, MAKE_FILENAME)
	makeFile, err := os.OpenFile(makePath, os.O_RDWR|os.O_TRUNC|os.O_CREATE, 0755)
	if err != nil {
		return errors.Join(errCommit, err)
	}

	return errors.Join(
		makeTempl.ExecuteTemplate(makeFile, makeTag, cfg.Members),
		makeFile.Close(),
	)
}

func cmdInitHandler() error {
	var cfg Config
	cfg.Default()
	return cfg.Commit()
}

func cmdSyncHandler() error {
	var cfg Config
	err := cfg.Load()
	if err != nil {
		return err
	}

	if cfg.dirPath != nil {
		os.Chdir(*cfg.dirPath)
	}

	execCmd := exec.Command("sh", "-c", cfg.Resolver)
	output, err := execCmd.Output()
	if err != nil {
		return err
	}

	cfg.Members = make(map[string]string)
	foundPaths := bytes.Split(output, []byte("\n"))
	for _, foundPath := range foundPaths {
		foundPathAbs, err := filepath.Abs(string(foundPath))
		if err != nil {
			slog.Warn(fmt.Sprintf("failed to get an absolute path of %s", foundPath))
			continue
		}

		foundMember := filepath.Base(foundPathAbs)
		cfg.Members[foundMember] = foundPathAbs
	}

	cfg.Members["root"] = *cfg.dirPath
	return cfg.Commit()
}

func cmdConfigHandler() error {
	var cfg Config
	err := cfg.Load()
	if err != nil {
		return err
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "    ")
	return encoder.Encode(&cfg)
}

func cmdFindHandler(toFind string) error {
	var cfg Config
	err := cfg.Load()
	if err != nil {
		return err
	}

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
		return errors.New("failed to find a related workspace member")
	}

	findResult := struct {
		Member string `json:"member"`
		Path   string `json:"path"`
	}{
		Member: longestMember,
		Path:   longestPath,
	}

	return json.NewEncoder(os.Stdout).Encode(&findResult)
}

func cmdRunHandler(workflow string) error {
	var cfg Config
	err := cfg.Load()
	if err != nil {
		return err
	}

	jobs, ok := cfg.Workflows[workflow]
	if !ok {
		return fmt.Errorf("%s doesn't exist in workflows", workflow)
	}

	parsedJobs := make(Jobs, len(jobs))
	for name, script := range jobs {
		tmpl, err := template.New(name).Parse(script)
		if err != nil {
			return fmt.Errorf("failed to parse script for %s.%s: %w", workflow, name, err)
		}

		var buf bytes.Buffer
		err = tmpl.Execute(&buf, &cfg)
		if err != nil {
			return fmt.Errorf("failed to interpolate script for %s.%s: %w", workflow, name, err)
		}

		parsedJobs[name] = buf.String()
	}

	resCh := make(chan JobResult, len(parsedJobs))
	sh := os.Getenv("SHELL")
	if sh == "" {
		sh = "bash"
	}

	for name, script := range parsedJobs {
		name, script := name, script
		run := func(logName string) error {
			logFile, err := os.Create(logName)
			if err != nil {
				return fmt.Errorf("failed to create %s: %w", logName, err)
			}
			defer logFile.Close()

			cmd := exec.Command(sh, "-c", script)
			cmd.Stdout = logFile
			cmd.Stderr = logFile
			return cmd.Run()
		}

		go func() {
			logName := fmt.Sprintf("%s.%s.log", workflow, name)
			startAt := time.Now()
			err := run(logName)
			resCh <- JobResult{
				StartAt:  startAt,
				Workflow: workflow,
				Job:      name,
				LogPath:  logName,
				Err:      err,
			}
		}()
		slog.Info("executing", "workflow", workflow, "job", name, "script", script)
	}

	for i := 0; i < len(parsedJobs); i++ {
		res := <-resCh
		slog.Info("finished",
			"workflow", res.Workflow, "job", res.Job, "duration", time.Since(res.StartAt),
			"log", res.LogPath, "err", res.Err)
	}

	return nil
}

func matchGoJson(data map[string]interface{}, key string, pattern *regexp.Regexp) bool {
	var ok bool
	var value interface{}
	tokens := strings.Split(key, ".")
	for _, token := range tokens {
		value = data[token]
		data, ok = value.(map[string]interface{})
		if !ok {
			break
		}
	}

	if value != nil {
		return pattern.MatchString(fmt.Sprint(value))
	}

	return false
}

func filterGoJson(data map[string]interface{}, filters map[string]*regexp.Regexp) bool {
	for k, f := range filters {
		if !matchGoJson(data, k, f) {
			return false
		}
	}
	return true
}

func decodeGoJson(filters map[string]*regexp.Regexp, line []byte) bool {
	data := make(map[string]interface{})
	err := json.Unmarshal(line, &data)
	if err != nil {
		return false
	}

	return filterGoJson(data, filters)
}

func cmdLinkHandler(from, to string, real, force bool) error {
	var err error
	from, err = filepath.Abs(from)
	if err != nil {
		return fmt.Errorf("failed to get the absolute for 'from': %w", err)
	}

	to, err = filepath.Abs(to)
	if err != nil {
		return fmt.Errorf("failed to get the absolute for 'to': %w", err)
	}

	return filepath.Walk(from, func(path string, info fs.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		newPath := strings.Replace(path, from, to, 1)
		newDir := filepath.Dir(newPath)

		err = os.MkdirAll(newDir, 0700)
		if err != nil {
			return fmt.Errorf("failed to create a new directory at %s: %w", newDir, err)
		}

		if real {
			_, err = os.Stat(newPath)
			if err == nil {
				if !force {
					return fmt.Errorf("%s already exists. use -force to override", newPath)
				}

				err = os.Remove(newPath)
				if err != nil {
					return fmt.Errorf("failed to delete %s: %w", newPath, err)
				}
			}

			err = os.Symlink(path, newPath)
			if err != nil {
				return fmt.Errorf("failed to create a symlink at %s: %w", newPath, err)
			}
		}

		slog.Info("linked", "real", real, "from", path, "to", newPath)
		return nil
	})
}

func cmdLogHandler(args []string) error {
	if len(args)%2 != 0 {
		return fmt.Errorf("log filters must be even")
	}

	filters := make(map[string]*regexp.Regexp)
	for i := 0; i < len(args); i += 2 {
		key := args[i]
		rawPattern := args[i+1]
		filters[key] = regexp.MustCompile(rawPattern)
	}

	scanner := bufio.NewScanner(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()
	for scanner.Scan() {
		line := scanner.Bytes()
		if decodeGoJson(filters, line) {
			fmt.Fprintln(writer, string(line))
		}
	}

	return nil
}
