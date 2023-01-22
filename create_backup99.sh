GUID_DIRNAME="DIR_2132"
GEN_DATE=$(date '+%Y-%m-%d-%H:%M:%S')
NEWBACKUP_FOLDER="$GUID_DIRNAME"
SOURCE_NEW_FILES="kmrityunjay-hugo-website-gen/public"

function CreateBackup ()
{
    mkdir -p $NEWBACKUP_FOLDER
    mv assets $NEWBACKUP_FOLDER
    mv categories $NEWBACKUP_FOLDER
    mv cv $NEWBACKUP_FOLDER
    mv favicon.ico $NEWBACKUP_FOLDER
    mv index.html $NEWBACKUP_FOLDER
    mv index.xml $NEWBACKUP_FOLDER
    mv sitemap.xml $NEWBACKUP_FOLDER
    mv tags $NEWBACKUP_FOLDER
}

function Cleanup ()
{
    rm -rf "kmrityunjay-hugo-website-gen"
}

function MoveBackupFolder ()
{
    mv $NEWBACKUP_FOLDER backups/
}

function NewRelease ()
{
    mv $SOURCE_NEW_FILES/assets .
    mv $SOURCE_NEW_FILES/categories .
    mv $SOURCE_NEW_FILES/cv .
    mv $SOURCE_NEW_FILES/favicon.ico .
    mv $SOURCE_NEW_FILES/index.html .
    mv $SOURCE_NEW_FILES/index.xml .
    mv $SOURCE_NEW_FILES/sitemap.xml .
    mv $SOURCE_NEW_FILES/tags .
}

function ExtractRelease ()
{
    tar -xzvf tag-code/release/public-2023-01-22-02:27:19.tgz
}

function Execute ()
{
    CreateBackup
    ExtractRelease
    NewRelease
    MoveBackupFolder
    Cleanup
}

Execute