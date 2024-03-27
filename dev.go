package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"

	"github.com/goccy/go-json"
	// "encoding/json"
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

type Config struct {
	Resolver string            `json:"resolver"`
	Members  map[string]string `json:"members"`
	dirPath  *string
}

func (cfg *Config) Default() {
	cfg.Resolver = DEFAULT_RESOLVER
	cfg.Members = make(map[string]string)
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

func match(data map[string]interface{}, key string, pattern *regexp.Regexp) bool {
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

func filter(data map[string]interface{}, filters map[string]*regexp.Regexp) bool {
	for k, f := range filters {
		if !match(data, k, f) {
			return false
		}
	}
	return true
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

	reader := os.Stdin
	readBuffer := make([]byte, 2048*2048)
	leftoverBuffer := make([]byte, 1024)
	leftoverSize := 0
	for {
		n, err := reader.Read(readBuffer)
		if err == io.EOF {
			break
		}

		// Find the last '\n' (byte=10)
		m := 0
		for i := n - 1; i >= 0; i-- {
			if readBuffer[i] == 10 {
				m = i
				break
			}
		}

		data := make([]byte, m+leftoverSize)
		copy(data, leftoverBuffer[:leftoverSize])
		copy(data[leftoverSize:], readBuffer[:m])
		copy(leftoverBuffer, readBuffer[m+1:n])
		leftoverSize = n - m

		jsonData := make(map[string]interface{})
		err = json.Unmarshal(data, &jsonData)
		if err != nil {
			continue
		}

		if filter(jsonData, filters) {
			fmt.Println(string(data))
		}
	}

	return nil
}
