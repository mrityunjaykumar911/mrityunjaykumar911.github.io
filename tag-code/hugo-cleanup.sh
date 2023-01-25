source ./common.config.sh
TARGET_WEB_FOLDER_NAME="kmrityunjay-hugo-website-gen"

function CleanUpHugo ()
{
    cd hugo-gen
    /bin/bash ./cleanup.sh
    cd ..
}

function CleanUpRelease ()
{
    rm -rf $TARGET_WEB_FOLDER_NAME
    CleanUpTarRelease
}

function CleanUpTarRelease ()
{
    if [ "$CLEANUP_RELEASE_FLAG" == true ]; then
        rm -rf release/*
    fi
}

function Execute ()
{
    CleanUpHugo
    CleanUpRelease
    
}


if [ "$CLEANUPEXEC" == true ]; then
    Execute
fi