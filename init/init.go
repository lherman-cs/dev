package init

import (
	_ "embed"
	"errors"
	"fmt"
	"os"

	"github.com/urfave/cli/v2"
)

//go:embed .envrc
var envrcTemplate []byte

const envrcFilename = ".envrc"

//go:embed devshell.toml
var devshellTemplate []byte

const devshellFilename = "devshell.toml"

//go:embed flake.nix
var flakeTemplate []byte

const flakeFilename = "flake.nix"

func Command() *cli.Command {
	return &cli.Command{
		Name:   "init",
		Usage:  "init dev environment for a package",
		Action: cmdInit,
	}
}

func cmdInit(cliCtx *cli.Context) error {
	if _, err := os.Stat(flakeFilename); err == nil {
		return fmt.Errorf("file already exists: %s", flakeFilename)
	}
	if _, err := os.Stat(devshellFilename); err == nil {
		return fmt.Errorf("file already exists: %s", devshellFilename)
	}
	if _, err := os.Stat(envrcFilename); err == nil {
		return fmt.Errorf("file already exists: %s", envrcFilename)
	}

	err := errors.Join(
		os.WriteFile(flakeFilename, flakeTemplate, 0664),
		os.WriteFile(devshellFilename, devshellTemplate, 0664),
		os.WriteFile(envrcFilename, envrcTemplate, 0664),
	)
	if err != nil {
		return err
	}

	fmt.Println("`nix develop` is ready to use for development!")
	return nil
}
