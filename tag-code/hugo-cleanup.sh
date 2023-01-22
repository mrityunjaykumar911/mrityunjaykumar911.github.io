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
}

function Execute ()
{
    CleanUpHugo
    CleanUpRelease
}

Execute