/**
 * ROS message definitions used by the Ecovacs X1 parsers, verbatim as the robot's
 * publishers send them in their TCPROS connection headers (`message_definition`).
 * Captured 2026-10-26 from an X1 Plus, fw 1.7.2. Fed to EcovacsRosMessageDecoder.
 *
 * Comments and `NAME = value` constants in the text are documentation; the decoder
 * only reads the field lines.
 */

const EcovacsRosDefinitions = Object.freeze({
    ROBOT: Object.freeze({
        topic: "/robot/Robot",
        type: "robot/Robot",
        md5sum: "5cfb7b142ed6323fe50812ffb59c30d4",
        text: `Header header
prediction/PredictPose pose
power/Battery battery
power/ChargeState chargestate
motor/MotorCurrent currents
rangeDet/RangeDetect rangeDetects
onOffInfo/OnOffInfo onOffInfo
onOffInfo/BumpValue[] bump
onOffInfo/DownInValue[] downin
onOffInfo/FallValue[] fall
onOffInfo/DirtBoxValue[] dirtbox
onOffInfo/CarpetValue[] carpet
onOffInfo/WaterBoxValue[] waterbox
lds/Lds ldsPic
================================================================================
MSG: std_msgs/Header
# Standard metadata for higher-level stamped data types.
# This is generally used to communicate timestamped data 
# in a particular coordinate frame.
# 
# sequence ID: consecutively increasing ID 
uint32 seq
#Two-integer timestamp that is expressed as:
# * stamp.sec: seconds (stamp_secs) since epoch (in Python the variable is called 'secs')
# * stamp.nsec: nanoseconds since stamp_secs (in Python the variable is called 'nsecs')
# time-handling sugar is provided by the client library
time stamp
#Frame this data is associated with
string frame_id

================================================================================
MSG: prediction/PredictPose
Pose predictPose
Pose pose
================================================================================
MSG: prediction/Pose
Header header
float32 x
float32 y
float32 theta
================================================================================
MSG: power/Battery
uint8 battery	# 0-100
uint8 isLowVoltageToPowerOff #low power signal.
================================================================================
MSG: power/ChargeState
# 0 not on charger , 1 on charger , 3 on 3d charger
uint8 isOnCharger
#enum
uint8 CHARGE_STATE_NOT_CHARGING = 0
uint8 CHARGE_STATE_NORMAL_CHARGING = 1
uint8 CHARGE_STATE_CHARGE_FULL = 2
uint8 CHARGE_STATE_CHARGE_ERROR = 3
uint8 CHARGE_STATE_CHARGE_ERROR_SWITCH_OFF = 4
uint8 chargeState
================================================================================
MSG: motor/MotorCurrent
MotorCurrentValue[] currents
================================================================================
MSG: motor/MotorCurrentValue
MotorType type
uint16 current
================================================================================
MSG: motor/MotorType
# type enum
uint8 MOTOR_TYPE_MAINBRUSH = 0
uint8 MOTOR_TYPE_LEFT_SIDEBRUSH = 1
uint8 MOTOR_TYPE_RIGHT_SIDEBRUSH = 2
uint8 MOTOR_TYPE_FAN = 3
uint8 MOTOR_TYPE_WATERPUMP = 4
uint8 TYPE_LEFTWHEEL = 5
uint8 TYPE_RIGHTWHEEL = 6
uint8 type    # TYPE
================================================================================
MSG: rangeDet/RangeDetect
Header header
RangeDetValue[] rangeDets
================================================================================
MSG: rangeDet/RangeDetValue
RangeDetType type
uint16[] values
================================================================================
MSG: rangeDet/RangeDetType
# type enum
uint8 RANGE_TYPE_FRONT_BUFFER = 0
uint8 RANGE_TYPE_SIDE_IN = 1
uint8 RANGE_TYPE_DOWN_IN = 2
uint8 RANGE_TYPE_ULTRASOUND = 3
uint8 type    # RANGE_TYPE
================================================================================
MSG: onOffInfo/OnOffInfo
OnOffSensorValue[] values
================================================================================
MSG: onOffInfo/OnOffSensorValue
# type enum
uint8 TYPE_BUMP = 0
uint8 TYPE_DOWNIN = 1
uint8 TYPE_FALL = 2
uint8 TYPE_DIRTBOX = 3
uint8 TYPE_CARPET = 4
uint8 TYPE_MOP = 5
uint8 type    # TYPE
uint8 value
================================================================================
MSG: onOffInfo/BumpValue
# type enum
uint8 TYPE_BUMP_LEFT = 0
uint8 TYPE_BUMP_RIGHT = 1
uint8 TYPE_BUMP_LDS = 2

uint8 type    # TYPE

uint8 VALUE_TRIGGER = 1
uint8 value
================================================================================
MSG: onOffInfo/DownInValue
# type enum
uint8 TYPE_DOWNIN_LEFT = 0
uint8 TYPE_DOWNIN_FRONT = 1
uint8 TYPE_DOWNIN_FRONT_RIGHT = 2
uint8 TYPE_DOWNIN_RIGHT = 3
uint8 TYPE_DOWNIN_LEFT_BACK = 4
uint8 TYPE_DOWNIN_RIGHT_BACK = 5
uint8 type    # TYPE

uint8 VALUE_TRIGGER = 1
uint8 value
================================================================================
MSG: onOffInfo/FallValue
# type enum
uint8 TYPE_FALL_LEFT = 0
uint8 TYPE_FALL_RIGHT = 1
uint8 type    # TYPE

uint8 VALUE_TRIGGER = 1
uint8 value
================================================================================
MSG: onOffInfo/DirtBoxValue
# type enum
uint8 TYPE_DIRTBOX_IN = 0
uint8 type    # TYPE

uint8 VALUE_TRIGGER = 1	# 1 represents dirtbox is SETTED.
uint8 value
================================================================================
MSG: onOffInfo/CarpetValue
# type enum
uint8 TYPE_CARPET_DETECT = 0
uint8 type    # TYPE

uint8 VALUE_TRIGGER = 1	# 1 represents carpet is detected.
uint8 value
================================================================================
MSG: onOffInfo/WaterBoxValue
# type enum
uint8 TYPE_WATERBOX_IN = 0
uint8 type    # TYPE

uint8 VALUE_WATERBOX_NOT_SET = 0	
uint8 VALUE_WATERBOX_IS_SET = 1
uint8 VALUE_ULTRA_WATERBOX_IS_SET = 2
uint8 value
================================================================================
MSG: lds/Lds
Header header
LdsPoint[] points
prediction/PredictPose ldsPose
================================================================================
MSG: lds/LdsPoint
float32 x
float32 y
float32 rho
float32 theta
float32 power`
    }),
    WORK_STATE: Object.freeze({
        topic: "/task/WorkState",
        type: "task/WorkState",
        md5sum: "7c5461ba785070010887a1c70028a484",
        text: `uint8 worktype
#uint8 subtype
uint8 state
WorkData data
uint8 workcause

================================================================================
MSG: task/WorkData
CleanWorkData cleanData
ExtraWorkData extraWorkData

================================================================================
MSG: task/CleanWorkData
uint8[] ids			# areaids or ai point ids 
map/Dot[] customAreas   # two dots forms one area.  spot clean
uint8[] cycles
float32 theta       # wakeup and clean theta
uint8[] states		# state of the clean procedure.
uint8[] types       # type of furniture




================================================================================
MSG: map/Dot
float32 x
float32 y

================================================================================
MSG: task/ExtraWorkData
uint8[] ids					# checkpoint ids or patrol point ids. ai guide types.
prediction/Pose[] poses		# goto poses
RemoteMove remotes    # remote control info
uint32 tasktime       # aroma time
uint8[] states		# state of the extra work procedure.

 

================================================================================
MSG: prediction/Pose
Header header
float32 x
float32 y
float32 theta
================================================================================
MSG: std_msgs/Header
# Standard metadata for higher-level stamped data types.
# This is generally used to communicate timestamped data 
# in a particular coordinate frame.
# 
# sequence ID: consecutively increasing ID 
uint32 seq
#Two-integer timestamp that is expressed as:
# * stamp.sec: seconds (stamp_secs) since epoch (in Python the variable is called 'secs')
# * stamp.nsec: nanoseconds since stamp_secs (in Python the variable is called 'nsecs')
# time-handling sugar is provided by the client library
time stamp
#Frame this data is associated with
string frame_id

================================================================================
MSG: task/RemoteMove
# move type.
uint8 RemoteMoveType
uint8 REMOTE_MOVE_FORWARD = 0
uint8 REMOTE_MOVE_BACKWARD = 1
uint8 REMOTE_MOVE_STOP = 2
uint8 REMOTE_MOVE_BRAKE = 3
uint8 REMOTE_MOVE_SPINLEFT = 4
uint8 REMOTE_MOVE_SPINRIGHT = 5
uint8 REMOTE_MOVE_GOTO = 6
uint8 REMOTE_MOVE_ROTATE = 7
uint8 REMOTE_MOVE_REVERSE = 8
uint8 REMOTE_MOVE_MVA_CUSTOM = 9
uint8 REMOTE_MOVE_TURN_LEFT = 10
uint8 REMOTE_MOVE_TURN_RIGHT = 11

uint16 lastTime
int16 v	
int16 w`
    }),
    CHARGER_DOCK_INFO: Object.freeze({
        topic: "/map/ChargerDockInfo",
        type: "map/ChargerDockInfo",
        md5sum: "1822602d70e60c7c106329c9490914be",
        text: `uint8 CHARGER_DOCK_UPDATE = 0
uint8 CHARGER_DOCK_REPORT = 1
uint8 CHARGER_DOCK_RESET = 2
uint8 CHARGER_DOCK_GET = 3 
uint8 CHARGER_DOCK_UPDATE_FRONT = 4
uint8 CHARGER_DOCK_UPDATE_FRONT_3D = 5
uint8 CHARGER_DOCK_UPDATE_3D = 6

uint8 docktype
uint8 info
uint32 mapid
uint8 hasGotDock
uint8 hasfindDock
uint8 hasFront3DDock
uint8 hasGot3DDock
ChargerDock Dockfront
ChargerDock dock
ChargerDock finddock
ChargerDock T3DDockfront
ChargerDock T3Ddock


================================================================================
MSG: map/ChargerDock
float32 x
float32 y
float32 theta`
    }),
    FAN_MODE: Object.freeze({
        topic: "/setting/FanMode",
        type: "setting/FanMode",
        md5sum: "73696a8e9688f16f90212b9067d55afb",
        text: `uint8 FAN_MODE_LOW = 0
uint8 FAN_MODE_HIGH = 1
uint8 FAN_MODE_HIGH_HIGH = 2

uint8 mode
uint8 isSilent`
    }),
    WATER_LEVEL: Object.freeze({
        topic: "/setting/WaterLevel",
        type: "setting/WaterLevel",
        md5sum: "c2d2edce3d88bf9dd1e01e9932b567b3",
        text: `uint8 WATER_LEVEL_LOW = 0
uint8 WATER_LEVEL_MIDDLE = 1
uint8 WATER_LEVEL_HIGH = 2
uint8 WATER_LEVEL_ULTRAHIGH = 3

uint8 level`
    }),
    TASK_STATE_REPORT: Object.freeze({
        topic: "/task/TaskStateReport",
        type: "task/TaskStateReport",
        md5sum: "7f1ec70d8debe1dd6d29d69cc9d76ab4",
        text: `# tasktype is WorkType
uint8 tasktype
# stateType is TaskStateType
uint32 stateType
# state for every type.
uint32 state`
    }),
    TASK_RESULT: Object.freeze({
        topic: "/task/TaskResult",
        type: "task/TaskResult",
        md5sum: "81d24bd15b1029477f43deb3f021e6d6",
        text: `#typed enum
uint8 GOTO = 0
uint8 PATROL = 1
uint8 REMOTE = 2
uint8 CLEAN = 3
uint8 RETURN = 4
uint8 AROMA = 5
uint8 FASTBUILD = 6
uint8 FINDPET = 7
uint8 type

#typed enum
uint8 TASK_SUCCESS = 0
uint8 TASK_FAILD = 1
uint8 TASK_WORKING = 2
uint8 RETURN_FAILD_FIND_CHARGE = 3
uint8 RETURN_FAILD_CANNOT_FIND_CHARGE = 4
uint8 AROMA_SUCCESS_TO_RETURN = 5
uint8 FAILED_FIND_AREA = 6

uint8 result

string data`
    }),
    LIFESPAN_REPORT: Object.freeze({
        topic: "/lifespan/lifespanreport",
        type: "lifespan/lifespanreport",
        md5sum: "94d915b1ea626737b94195d388d2d76d",
        text: `uint8 MAIN_BRUSH
uint8 SIDE_BRUSH
uint8 LIFE_HEPA
uint8 XIANGXUN
uint8 DUSTBAG
uint8 SILVERION
uint8 DOORBAR
uint8 MOP`
    })
});

module.exports = EcovacsRosDefinitions;
