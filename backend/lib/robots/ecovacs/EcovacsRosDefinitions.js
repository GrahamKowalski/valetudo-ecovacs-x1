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
    })
});

module.exports = EcovacsRosDefinitions;
