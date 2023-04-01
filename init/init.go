package init

import (
	_ "embed"
	"errors"
	"fmt"
	"io/ioutil"

	"github.com/urfave/cli/v2"
)

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
	err := errors.Join(
		ioutil.WriteFile(flakeFilename, flakeTemplate, 0644),
		ioutil.WriteFile(devshellFilename, devshellTemplate, 0644),
	)
	if err != nil {
		return err
	}

	fmt.Println("`nix develop` is ready to use for development!")
	return nil
}
