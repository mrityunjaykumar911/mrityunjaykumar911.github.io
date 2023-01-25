source ./common.config.sh
function Execute ()
{
    cd hugo-gen
    if [ "$RELEASE_GITHUB" == true ]; then
        echo "running github version <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<"
        /bin/bash ./create-hugo-kmrityunjay.sh "config-github.toml"
    else
        echo "running FTP version <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<"
        /bin/bash ./create-hugo-kmrityunjay.sh
    fi
    cd ..
}

Execute