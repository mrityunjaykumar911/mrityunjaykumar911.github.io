RELEASE_GITHUB=1
function Execute ()
{
    cd hugo-gen
    if [ $RELEASE_GITHUB ]; then
        /bin/bash ./create-hugo-kmrityunjay.sh "config-github.toml"
    else
        /bin/bash ./create-hugo-kmrityunjay.sh
    fi
    cd ..
}

Execute