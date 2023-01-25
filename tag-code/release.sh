source ./common.config.sh
TARGET_WEB_FOLDER_NAME="kmrityunjay-hugo-website-gen"
GEN="release"
GEN_DATE=$(date '+%Y-%m-%d-%H:%M:%S')
INTERMEDIATE_GEN="1223-release"
SCM_CONTROL="git"

if [ $RELEASE_GITHUB == true ]; then
    SCM_CONTROL="git"
    GEN_DATE="${GEN_DATE}-git"
else
    SCM_CONTROL="FTP"
    GEN_DATE="${GEN_DATE}-FTP"
fi

echo "release is ${GEN_DATE}"

function Init ()
{
    mkdir -p $GEN/$SCM_CONTROL
}

function CreateBackup ()
{
    echo "back"
}

function UnTar ()
{
    tar -xzvf hugo-gen/op/public-$INTERMEDIATE_GEN.tgz
}

function CopyFileToDestination ()
{
    mkdir -p $TARGET_WEB_FOLDER_NAME/public/cv/cv
    cp -r tex-code/tex-src/camera-ready/mrityunjay-kumar-cv-2023-01-22-00:49:32.html $TARGET_WEB_FOLDER_NAME/public/cv/cv/MrityunjayKumarCV.pdf.html
    cp -r tex-code/tex-src/camera-ready/mrityunjay-kumar-cv-2023-01-22-00:49:32.pdf $TARGET_WEB_FOLDER_NAME/public/cv/cv/MrityunjayKumarCV.pdf
}

function Retar ()
{
    tar -vcf "$GEN/$SCM_CONTROL/public-$GEN_DATE.tgz" "$TARGET_WEB_FOLDER_NAME/public"
}

function Execute ()
{
    Init
    UnTar
    CopyFileToDestination
    Retar
}

Execute