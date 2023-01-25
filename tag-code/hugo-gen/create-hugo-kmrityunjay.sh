source ../common.config.sh
red=`tput setaf 1`
green=`tput setaf 2`
reset=`tput sgr0`
TARGET_WEB_FOLDER_NAME="kmrityunjay-hugo-website-gen"
GEN="op"
GEN_DATE="1223-release"
CONFIG_TOMLFILE="config.toml"

if [ $RELEASE_GITHUB == true ]; then
    CONFIG_TOMLFILE="config-github.toml"
fi

function CheckIfHugoInstalled ()
{
    RET="`which hugo`"
    RETURN_CODE="$?"
    if [ $RETURN_CODE -eq 0 ]; then
        echo "${green}Installed${reset}"
    else
        echo "${red}Please install hugo and try again${reset}"
        exit 1
    fi
}

function CreateAuxFolders ()
{
    mkdir -p $TARGET_WEB_FOLDER_NAME
    mkdir -p $GEN
}

function Init ()
{
    CheckIfHugoInstalled
    CreateAuxFolders
}

function CreateHugoWebsite ()
{
    hugo new site $TARGET_WEB_FOLDER_NAME
}

function CleanupHugoWeb ()
{
    rm -rf $TARGET_WEB_FOLDER_NAME
}

function ReplaceConfigToML ()
{
    echo "config ML file is $CONFIG_TOMLFILE"
    cp $CONFIG_TOMLFILE $TARGET_WEB_FOLDER_NAME/config.toml
}

function CloneGitSubModule ()
{
    CWD="`pwd`"
    cd $TARGET_WEB_FOLDER_NAME

    # goto themes folder & clone
    cd themes
    git clone git@github.com:mrityunjaykumar911/hugo-devresume-theme.git
    cd $CWD
}

function BuildHugo ()
{
    CWD="`pwd`"
    cd $TARGET_WEB_FOLDER_NAME
    hugo
    cd $CWD
}

function CreateTarFolder ()
{
    tar -vcf "$GEN/public-$GEN_DATE.tgz" "$TARGET_WEB_FOLDER_NAME/public"
}

function Execute ()
{
    # init
    Init
    
    CreateHugoWebsite
    ReplaceConfigToML
    CloneGitSubModule

    #
    
    # build -> generate public folder 
    BuildHugo

    # & create a tar file
    CreateTarFolder
}

Execute